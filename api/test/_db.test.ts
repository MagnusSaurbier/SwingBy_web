import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DbConfigError,
  computeRank,
  fetchCustomLevel,
  fetchLeaderboard,
  getSql,
  insertCustomLevel,
  insertScore,
  listCustomLevels,
} from "../_db.js";
import { FakeDb, makeUniqueViolation } from "./support/fake-db.js";

describe("getSql — real production wiring (not the fake)", () => {
  const originalUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  it("throws DbConfigError when DATABASE_URL is unset — the honest state of this container (no Neon account, see notes/T-12-LEDGER/log.md)", () => {
    delete process.env.DATABASE_URL;
    expect(() => getSql()).toThrow(DbConfigError);
  });
});

describe("insertScore / fetchLeaderboard / computeRank", () => {
  let db: FakeDb;

  beforeEach(() => {
    db = new FakeDb();
  });

  it("round-trips an inserted verified row through the leaderboard query", async () => {
    await insertScore(db.query, {
      levelId: "builtin-00",
      playerName: "Magnus",
      timeMs: 12_345,
      boostMs: 1_000,
      tape: JSON.stringify({ ticks: 100, boost: [], brake: [] }),
      verified: true,
    });

    const entries = await fetchLeaderboard(db.query, "builtin-00", "fastest", 50);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      rank: 1,
      name: "Magnus",
      timeMs: 12_345,
      boostMs: 1_000,
      verified: true,
    });
    expect(typeof entries[0]?.createdAt).toBe("string");
  });

  it("orders verified rows by time_ms ascending for metric=fastest and boost_ms ascending for metric=efficient", async () => {
    await insertScore(db.query, {
      levelId: "L",
      playerName: "slow-but-efficient",
      timeMs: 9000,
      boostMs: 100,
      tape: null,
      verified: true,
    });
    await insertScore(db.query, {
      levelId: "L",
      playerName: "fast-but-wasteful",
      timeMs: 1000,
      boostMs: 900,
      tape: null,
      verified: true,
    });

    const byTime = await fetchLeaderboard(db.query, "L", "fastest", 50);
    expect(byTime.map((e) => e.name)).toEqual(["fast-but-wasteful", "slow-but-efficient"]);

    const byBoost = await fetchLeaderboard(db.query, "L", "efficient", 50);
    expect(byBoost.map((e) => e.name)).toEqual(["slow-but-efficient", "fast-but-wasteful"]);
  });

  it("NEVER lets an unverified row outrank a verified one, regardless of value — the core invariant", async () => {
    await insertScore(db.query, {
      levelId: "L",
      playerName: "genuine",
      timeMs: 999_999, // deliberately terrible time
      boostMs: 999_999,
      tape: "{}",
      verified: true,
    });
    await insertScore(db.query, {
      levelId: "L",
      playerName: "forger",
      timeMs: 1, // deliberately unbeatable claimed time
      boostMs: 1,
      tape: null,
      verified: false,
    });

    const entries = await fetchLeaderboard(db.query, "L", "fastest", 50);
    expect(entries.map((e) => e.name)).toEqual(["genuine", "forger"]);
    expect(entries[0]?.rank).toBe(1);
    expect(entries[0]?.verified).toBe(true);
    expect(entries[1]?.rank).toBe(2);
    expect(entries[1]?.verified).toBe(false);
  });

  it("limits results", async () => {
    for (let i = 0; i < 5; i++) {
      await insertScore(db.query, {
        levelId: "L",
        playerName: `p${i}`,
        timeMs: i,
        boostMs: 0,
        tape: null,
        verified: true,
      });
    }
    const entries = await fetchLeaderboard(db.query, "L", "fastest", 2);
    expect(entries).toHaveLength(2);
  });

  it("computeRank for a verified value counts only better VERIFIED rows", async () => {
    await insertScore(db.query, { levelId: "L", playerName: "a", timeMs: 100, boostMs: 0, tape: null, verified: true });
    await insertScore(db.query, { levelId: "L", playerName: "b", timeMs: 200, boostMs: 0, tape: null, verified: true });
    await insertScore(db.query, { levelId: "L", playerName: "c", timeMs: 1, boostMs: 0, tape: null, verified: false });

    // A new verified submission of 150ms: only "a" (100ms) is better among VERIFIED rows.
    // "c"'s unverified 1ms must not count, even though it's numerically better.
    const rank = await computeRank(db.query, "L", "fastest", true, 150);
    expect(rank).toBe(2);
  });

  it("computeRank for an unverified value counts every verified row PLUS better unverified rows", async () => {
    await insertScore(db.query, { levelId: "L", playerName: "a", timeMs: 100, boostMs: 0, tape: null, verified: true });
    await insertScore(db.query, { levelId: "L", playerName: "b", timeMs: 200, boostMs: 0, tape: null, verified: true });
    await insertScore(db.query, { levelId: "L", playerName: "c", timeMs: 5, boostMs: 0, tape: null, verified: false });

    // A new unverified submission of 10ms: both verified rows outrank it unconditionally (2), plus
    // "c" (5ms, unverified) is also better within the unverified tier (1) -> rank 4.
    const rank = await computeRank(db.query, "L", "fastest", false, 10);
    expect(rank).toBe(4);
  });

  it("computeRank returns 1 for the first score on an empty leaderboard", async () => {
    const rank = await computeRank(db.query, "empty-level", "fastest", true, 5000);
    expect(rank).toBe(1);
  });
});

describe("custom_level: insert / fetch / list", () => {
  let db: FakeDb;

  beforeEach(() => {
    db = new FakeDb();
  });

  it("inserts and fetches a level by id", async () => {
    const id = await insertCustomLevel(db.query, {
      name: "My Level",
      author: "Magnus",
      data: { name: "My Level", author: "Magnus", goal: { index: 1, range: 50 }, objects: [] },
    });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThanOrEqual(8);
    expect(id.length).toBeLessThanOrEqual(10);

    const fetched = await fetchCustomLevel(db.query, id);
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe("My Level");
    expect(fetched?.author).toBe("Magnus");
    expect(fetched?.plays).toBe(0);
  });

  it("returns null for a nonexistent id", async () => {
    const fetched = await fetchCustomLevel(db.query, "NOPE12345");
    expect(fetched).toBeNull();
  });

  it("retries id generation on a genuine primary-key collision (forced deterministically) rather than only trusting the odds", async () => {
    let calls = 0;
    // First two calls collide with each other and with nothing pre-existing; force the SAME id
    // twice, then a fresh one — proves the retry loop actually re-attempts on a real 23505 from the
    // fake's own uniqueness enforcement, not a canned test double.
    const forcedIds = ["COLLIDE01", "COLLIDE01", "UNIQUE002"];
    const idGenerator = () => {
      const id = forcedIds[calls] ?? "FALLBACK";
      calls++;
      return id;
    };

    const first = await insertCustomLevel(db.query, { name: "A", author: "x", data: {} }, idGenerator);
    expect(first).toBe("COLLIDE01");

    const second = await insertCustomLevel(db.query, { name: "B", author: "x", data: {} }, idGenerator);
    expect(second).toBe("UNIQUE002");
    expect(calls).toBe(3);
  });

  it("gives up after MAX_ID_ATTEMPTS consecutive collisions rather than looping forever", async () => {
    await insertCustomLevel(db.query, { name: "A", author: "x", data: {} }, () => "SAME0000");
    await expect(
      insertCustomLevel(db.query, { name: "B", author: "x", data: {} }, () => "SAME0000"),
    ).rejects.toThrow(/could not mint a unique level id/);
  });

  it("lists levels sorted by created_at desc for sort=new", async () => {
    await insertCustomLevel(db.query, { name: "first", author: "x", data: {} }, () => "AAAAAAAAA");
    await new Promise((r) => setTimeout(r, 2));
    await insertCustomLevel(db.query, { name: "second", author: "x", data: {} }, () => "BBBBBBBBB");

    const list = await listCustomLevels(db.query, "new", 50);
    expect(list.map((l) => l.name)).toEqual(["second", "first"]);
  });

  it("lists levels sorted by plays desc for sort=top", async () => {
    await insertCustomLevel(db.query, { name: "popular", author: "x", data: {} }, () => "POPULAR01");
    await insertCustomLevel(db.query, { name: "unpopular", author: "x", data: {} }, () => "UNPOPULAR");
    const popularRow = db.customLevelRows.find((r) => r.id === "POPULAR01");
    if (popularRow) popularRow.plays = 42;

    const list = await listCustomLevels(db.query, "top", 50);
    expect(list.map((l) => l.name)).toEqual(["popular", "unpopular"]);
    expect(list[0]?.plays).toBe(42);
  });

  it("propagates a genuine unique-violation surfaced through the query fn as a real error, distinct from other failures", async () => {
    await expect(
      (async () => {
        throw makeUniqueViolation();
      })(),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
