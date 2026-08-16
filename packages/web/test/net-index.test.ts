/**
 * T-13 PODIUM — tests for net/index.ts (deliverable 1: `createApi`/`Api`), against a REAL local
 * server (test/mock-api.ts). Covers the happy path for all four methods, the "API genuinely
 * unreachable" degradation for `leaderboard`/`submitScore` (must resolve, never reject), and the
 * documented rejection behaviour for `shareLevel`/`fetchLevel` (their frozen return types have no
 * failure slot, so a caller must catch — see net/index.ts's header comment).
 */
import { afterEach, describe, expect, it } from "vitest";

import type { Level, ReplayTape } from "@swingby/core";
import { createApi } from "../src/net/index.js";
import { startMockApi, type MockApiHandle } from "./mock-api.js";

const EMPTY_TAPE: ReplayTape = { ticks: 100, boost: [], brake: [] };

const SAMPLE_LEVEL: Level = {
  name: "Sample",
  author: "Ada",
  goal: { index: 1, range: 50 },
  objects: [
    { type: "player", x: 0, y: 0, gravity: 0 },
    { type: "sun", x: 200, y: 200, gravity: 500 },
  ],
};

let handle: MockApiHandle | null = null;

afterEach(async () => {
  if (handle) {
    await handle.close();
    handle = null;
  }
});

describe("createApi().leaderboard", () => {
  it("returns validated entries from a live server", async () => {
    handle = await startMockApi();
    handle.seedLeaderboard("builtin-00", "fastest", [
      { rank: 1, name: "Ada", timeMs: 1000, boostMs: 100, verified: true },
      { rank: 2, name: "Bo", timeMs: 1500, boostMs: 200, verified: false },
    ]);
    const api = createApi(handle.url);
    const entries = await api.leaderboard("builtin-00", "fastest");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      rank: 1,
      name: "Ada",
      timeMs: 1000,
      boostMs: 100,
      verified: true,
    });
  });

  it("degrades to [] (never rejects) when the API is genuinely unreachable", async () => {
    const dead = await startMockApi();
    const url = dead.url;
    await dead.close();
    const api = createApi(url);
    await expect(api.leaderboard("builtin-00", "fastest")).resolves.toEqual([]);
  });

  it("degrades to [] on a malformed response body rather than throwing", async () => {
    handle = await startMockApi();
    handle.setLeaderboardHandler(() => ({
      status: 200,
      bodyRaw: "not json at all",
    }));
    const api = createApi(handle.url);
    await expect(api.leaderboard("builtin-00", "fastest")).resolves.toEqual([]);
  });
});

describe("createApi().submitScore", () => {
  it("submits and returns accepted + rank on the happy path", async () => {
    handle = await startMockApi();
    const api = createApi(handle.url);
    const result = await api.submitScore({
      levelId: "builtin-00",
      metric: "fastest",
      timeMs: 1234,
      boostMs: 56,
      name: "Ada",
      tape: EMPTY_TAPE,
    });
    expect(result.accepted).toBe(true);
    expect(typeof result.rank).toBe("number");
  });

  it("sends exactly the documented fields and nothing else (payload discipline)", async () => {
    handle = await startMockApi();
    const api = createApi(handle.url);
    await api.submitScore({
      levelId: "builtin-00",
      metric: "fastest",
      timeMs: 1234,
      boostMs: 56,
      name: "Ada",
      tape: EMPTY_TAPE,
    });
    const req = handle.requests.find((r) => r.path === "/api/score");
    expect(req).toBeDefined();
    const body = req?.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["boostMs", "levelId", "metric", "name", "tape", "timeMs"].sort(),
    );
  });

  it("degrades to {accepted:false} (never rejects) when unreachable", async () => {
    const dead = await startMockApi();
    const url = dead.url;
    await dead.close();
    const api = createApi(url);
    await expect(
      api.submitScore({
        levelId: "builtin-00",
        metric: "fastest",
        timeMs: 1000,
        boostMs: 10,
        name: "Ada",
        tape: EMPTY_TAPE,
      }),
    ).resolves.toEqual({ accepted: false });
  });

  it("degrades to {accepted:false} on a hung server, bounded by the request timeout", async () => {
    handle = await startMockApi();
    handle.setScoreHandler(() => "hang");
    const api = createApi(handle.url);
    // Uses the real createApi -> requestJson -> REQUEST_TIMEOUT_MS path (4000ms default). This
    // test intentionally waits it out once to prove the PRODUCTION timeout value actually governs
    // (not a shortened test-only override) — see net-http.test.ts for the fast, short-timeout
    // version of the same mechanism.
    const start = Date.now();
    const result = await api.submitScore({
      levelId: "builtin-00",
      metric: "fastest",
      timeMs: 1000,
      boostMs: 10,
      name: "Ada",
      tape: EMPTY_TAPE,
    });
    const elapsed = Date.now() - start;
    expect(result.accepted).toBe(false);
    expect(elapsed).toBeLessThan(4500);
    expect(elapsed).toBeGreaterThanOrEqual(3900);
  }, 10_000);
});

describe("createApi().shareLevel", () => {
  it("returns an id and a URL on the happy path", async () => {
    handle = await startMockApi();
    const api = createApi(handle.url);
    const result = await api.shareLevel(SAMPLE_LEVEL);
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
    expect(result.url).toContain(`/l/${result.id}`);
  });

  it("sends only {name, author, data} to POST /api/levels", async () => {
    handle = await startMockApi();
    const api = createApi(handle.url);
    await api.shareLevel(SAMPLE_LEVEL);
    const req = handle.requests.find(
      (r) => r.path === "/api/levels" && r.method === "POST",
    );
    const body = req?.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["author", "data", "name"]);
  });

  it("rejects (frozen return type has no failure slot) when unreachable", async () => {
    const dead = await startMockApi();
    const url = dead.url;
    await dead.close();
    const api = createApi(url);
    await expect(api.shareLevel(SAMPLE_LEVEL)).rejects.toThrow();
  });

  it("rejects on a malformed id in the response rather than building a broken share URL", async () => {
    handle = await startMockApi();
    handle.setLevelsCreateHandler(() => ({
      status: 200,
      bodyRaw: JSON.stringify({ id: "../etc/passwd" }),
    }));
    const api = createApi(handle.url);
    await expect(api.shareLevel(SAMPLE_LEVEL)).rejects.toThrow();
  });
});

describe("createApi().fetchLevel", () => {
  it("fetches and validates a shared level end-to-end (share -> fetch)", async () => {
    handle = await startMockApi();
    const api = createApi(handle.url);
    const shared = await api.shareLevel(SAMPLE_LEVEL);
    const fetched = await api.fetchLevel(shared.id);
    expect(fetched.name).toBe(SAMPLE_LEVEL.name);
    expect(fetched.objects).toHaveLength(2);
  });

  it("rejects for an unknown id (404)", async () => {
    handle = await startMockApi();
    const api = createApi(handle.url);
    await expect(api.fetchLevel("does-not-exist")).rejects.toThrow();
  });

  it("rejects when the server returns a gameplay-invalid level (no player)", async () => {
    handle = await startMockApi();
    handle.seedLevel("bad1", {
      name: "Bad",
      author: "Eve",
      data: {
        name: "Bad",
        author: "Eve",
        goal: { index: 0, range: 10 },
        objects: [],
      },
    });
    const api = createApi(handle.url);
    await expect(api.fetchLevel("bad1")).rejects.toThrow();
  });

  it("rejects when unreachable", async () => {
    const dead = await startMockApi();
    const url = dead.url;
    await dead.close();
    const api = createApi(url);
    await expect(api.fetchLevel("anything")).rejects.toThrow();
  });
});
