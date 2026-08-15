/**
 * T-12 LEDGER — GET /api/leaderboard.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { handleLeaderboard } from "../leaderboard.js";
import { insertScore } from "../_db.js";
import { FakeDb } from "./support/fake-db.js";

describe("handleLeaderboard", () => {
  let db: FakeDb;

  beforeEach(() => {
    db = new FakeDb();
  });

  it("returns an empty entries array for a level with no scores", async () => {
    const { status, body } = await handleLeaderboard(
      { level: "builtin-00", metric: "fastest" },
      db.query,
    );
    expect(status).toBe(200);
    expect(body).toEqual({ entries: [] });
  });

  it("returns entries in the frozen response shape (rank, name, timeMs, boostMs, verified, createdAt)", async () => {
    await insertScore(db.query, {
      levelId: "builtin-00",
      playerName: "Magnus",
      timeMs: 5000,
      boostMs: 200,
      tape: null,
      verified: true,
    });

    const { body } = await handleLeaderboard(
      { level: "builtin-00", metric: "fastest" },
      db.query,
    );
    expect("entries" in body).toBe(true);
    if ("entries" in body) {
      expect(body.entries).toHaveLength(1);
      const entry = body.entries[0];
      expect(entry).toEqual({
        rank: 1,
        name: "Magnus",
        timeMs: 5000,
        boostMs: 200,
        verified: true,
        createdAt: expect.any(String),
      });
    }
  });

  it("never lets an unverified entry outrank a verified one, at the HTTP-response level, regardless of value", async () => {
    await insertScore(db.query, {
      levelId: "L",
      playerName: "genuine-but-slow",
      timeMs: 50_000,
      boostMs: 0,
      tape: null,
      verified: true,
    });
    await insertScore(db.query, {
      levelId: "L",
      playerName: "forged-and-fast",
      timeMs: 1,
      boostMs: 0,
      tape: null,
      verified: false,
    });

    const { body } = await handleLeaderboard(
      { level: "L", metric: "fastest" },
      db.query,
    );
    if ("entries" in body) {
      expect(body.entries.map((e) => e.name)).toEqual([
        "genuine-but-slow",
        "forged-and-fast",
      ]);
      expect(body.entries[0]?.rank).toBe(1);
      expect(body.entries[1]?.rank).toBe(2);
    } else {
      throw new Error("expected entries");
    }
  });

  it("respects limit, clamped to the max", async () => {
    for (let i = 0; i < 10; i++) {
      await insertScore(db.query, {
        levelId: "L",
        playerName: `p${i}`,
        timeMs: i,
        boostMs: 0,
        tape: null,
        verified: true,
      });
    }
    const { body } = await handleLeaderboard(
      { level: "L", metric: "fastest", limit: "3" },
      db.query,
    );
    if ("entries" in body) expect(body.entries).toHaveLength(3);
    else throw new Error("expected entries");
  });

  it("orders by boost_ms for metric=efficient", async () => {
    await insertScore(db.query, {
      levelId: "L",
      playerName: "a",
      timeMs: 1,
      boostMs: 900,
      tape: null,
      verified: true,
    });
    await insertScore(db.query, {
      levelId: "L",
      playerName: "b",
      timeMs: 2,
      boostMs: 100,
      tape: null,
      verified: true,
    });
    const { body } = await handleLeaderboard(
      { level: "L", metric: "efficient" },
      db.query,
    );
    if ("entries" in body)
      expect(body.entries.map((e) => e.name)).toEqual(["b", "a"]);
    else throw new Error("expected entries");
  });

  it("rejects an invalid level id (SQL metacharacters) with a clean 400, never touching the database", async () => {
    const { status, body } = await handleLeaderboard(
      { level: "'; DROP TABLE score;--", metric: "fastest" },
      db.query,
    );
    expect(status).toBe(400);
    expect("error" in body).toBe(true);
    expect(db.queryLog).toHaveLength(0);
  });

  it("rejects a missing level param", async () => {
    const { status } = await handleLeaderboard({ metric: "fastest" }, db.query);
    expect(status).toBe(400);
  });

  it("rejects an invalid metric (allowlist, including SQL metacharacters)", async () => {
    const { status, body } = await handleLeaderboard(
      { level: "builtin-00", metric: "fastest; DROP TABLE score;--" },
      db.query,
    );
    expect(status).toBe(400);
    expect("error" in body).toBe(true);
    expect(db.queryLog).toHaveLength(0);
  });

  it("rejects a missing metric param", async () => {
    const { status } = await handleLeaderboard(
      { level: "builtin-00" },
      db.query,
    );
    expect(status).toBe(400);
  });

  it("handles Vercel's array-of-strings query shape (repeated query params)", async () => {
    await insertScore(db.query, {
      levelId: "builtin-00",
      playerName: "Magnus",
      timeMs: 100,
      boostMs: 0,
      tape: null,
      verified: true,
    });
    const { status, body } = await handleLeaderboard(
      { level: ["builtin-00", "builtin-01"], metric: ["fastest", "efficient"] },
      db.query,
    );
    expect(status).toBe(200);
    if ("entries" in body) expect(body.entries).toHaveLength(1);
    else throw new Error("expected entries");
  });
});
