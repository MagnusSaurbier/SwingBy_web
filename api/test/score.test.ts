/**
 * T-12 LEDGER — POST /api/score. This is the file that proves the entire point of the task: server-
 * side `verifyReplay` runs before anything is trusted, a tampered tape is rejected, a claim that
 * doesn't match the replay is rejected, and none of that can be bypassed by a hostile payload shape.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { handleScore, resolveLevel } from "../score.js";
import { scoreRateLimiter, SCORE_RATE_LIMIT } from "../_ratelimit.js";
import { BUILTIN_LEVELS, levelId, verifyReplay } from "@swingby/core";
import { FakeDb } from "./support/fake-db.js";
import { flipOneTransition, loadAllGenuineCases, loadGenuineCase } from "./support/genuine.js";

describe("resolveLevel", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb();
  });

  it("resolves a builtin level id straight into BUILTIN_LEVELS", async () => {
    const level = await resolveLevel(db.query, "builtin-00");
    expect(level).toBe(BUILTIN_LEVELS[0]);
  });

  it("returns null for an out-of-range but well-formed builtin-looking id", async () => {
    const level = await resolveLevel(db.query, "builtin-99");
    expect(level).toBeNull();
  });

  it("returns null for an unknown custom id", async () => {
    const level = await resolveLevel(db.query, "NOSUCHID1");
    expect(level).toBeNull();
  });
});

describe("handleScore — genuine submissions (real T-03 solving tapes)", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb();
  });

  it("accepts a genuine playthrough, verifies it, and ranks it #1 on an empty board", async () => {
    const genuine = loadGenuineCase(0);
    const { status, body } = await handleScore(
      {
        levelId: genuine.levelId,
        metric: "fastest",
        timeMs: genuine.timeMs,
        boostMs: genuine.boostMs,
        name: "Magnus",
        tape: genuine.tape,
      },
      { sql: db.query },
    );

    expect(status).toBe(200);
    expect(body).toEqual({ accepted: true, verified: true, rank: 1 });
    expect(db.scoreRows).toHaveLength(1);
    expect(db.scoreRows[0]?.verified).toBe(true);
    // The stored row uses the SERVER's recomputed values, not blindly the client's claim (which
    // happened to be correct here, but the row is proven independently below to differ from a
    // forged claim — see "never trusts the claimed score").
    expect(db.scoreRows[0]?.time_ms).toBe(genuine.timeMs);
  });

  it("ALL 33 built-in levels' genuine solving tapes are accepted and verified — the corpus-level proof, not one cherry-picked example", async () => {
    const cases = loadAllGenuineCases();
    let accepted = 0;
    for (const c of cases) {
      const { body } = await handleScore(
        {
          levelId: c.levelId,
          metric: "fastest",
          timeMs: c.timeMs,
          boostMs: c.boostMs,
          name: "Tester",
          tape: c.tape,
        },
        { sql: db.query },
      );
      if (body.accepted && body.verified) accepted++;
    }
    expect(accepted).toBe(33);
  });

  it("never stores the client's claimed value verbatim when it disagrees with the server's own recomputation — recompute, never accept", async () => {
    const genuine = loadGenuineCase(1);
    // Claim is within tolerance (8ms) but not bit-identical to the server's recomputed value —
    // proves the row is built from `result.timeMs`, not `parsed.timeMs`.
    const nudgedClaim = genuine.timeMs + 3;
    const { body } = await handleScore(
      {
        levelId: genuine.levelId,
        metric: "fastest",
        timeMs: nudgedClaim,
        boostMs: genuine.boostMs,
        name: "Tester",
        tape: genuine.tape,
      },
      { sql: db.query },
    );
    expect(body.accepted).toBe(true);
    expect(db.scoreRows[0]?.time_ms).toBe(genuine.timeMs); // server truth, not `nudgedClaim`
  });
});

describe("handleScore — forgery rejection (Definition of Done: tampered tape, wrong claim)", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb();
  });

  it("rejects a tampered tape (one flipped transition index) — DoD: 'A tampered tape (one flipped index) is rejected'", async () => {
    const genuine = loadGenuineCase(0);
    const tampered = flipOneTransition(genuine.tape);
    expect(tampered).not.toBeNull();

    const { status, body } = await handleScore(
      {
        levelId: genuine.levelId,
        metric: "fastest",
        timeMs: genuine.timeMs,
        boostMs: genuine.boostMs,
        name: "Forger",
        tape: tampered,
      },
      { sql: db.query },
    );

    expect(status).toBe(200);
    expect(body.accepted).toBe(false);
    expect(body.verified).toBe(false);
    expect(db.scoreRows).toHaveLength(0); // never stored — see notes/T-12-LEDGER/log.md decision 1
  });

  it("rejects a tampered tape across ALL 33 levels where a flip was possible — accept/reject counts, not a single example", async () => {
    const cases = loadAllGenuineCases();
    let flippable = 0;
    let rejected = 0;
    let unexpectedlyAccepted = 0;

    for (const c of cases) {
      const tampered = flipOneTransition(c.tape);
      if (tampered === null) continue;
      flippable++;
      const { body } = await handleScore(
        {
          levelId: c.levelId,
          metric: "fastest",
          timeMs: c.timeMs,
          boostMs: c.boostMs,
          name: "Forger",
          tape: tampered,
        },
        { sql: db.query },
      );
      if (body.accepted) unexpectedlyAccepted++;
      else rejected++;
    }

    expect(flippable).toBeGreaterThan(0);
    expect(unexpectedlyAccepted).toBe(0);
    expect(rejected).toBe(flippable);
  });

  it("rejects a claimed time that does not match the replay (+500ms) — DoD: 'A claimed time that does not match the replay is rejected'", async () => {
    const genuine = loadGenuineCase(0);
    const { status, body } = await handleScore(
      {
        levelId: genuine.levelId,
        metric: "fastest",
        timeMs: genuine.timeMs + 500,
        boostMs: genuine.boostMs,
        name: "Forger",
        tape: genuine.tape,
      },
      { sql: db.query },
    );
    expect(status).toBe(200);
    expect(body).toEqual({ accepted: false, verified: false, reason: "time-mismatch" });
    expect(db.scoreRows).toHaveLength(0);
  });

  it("rejects a +500ms inflated claim across all 33 levels", async () => {
    const cases = loadAllGenuineCases();
    let rejected = 0;
    for (const c of cases) {
      const { body } = await handleScore(
        {
          levelId: c.levelId,
          metric: "fastest",
          timeMs: c.timeMs + 500,
          boostMs: c.boostMs,
          name: "Forger",
          tape: c.tape,
        },
        { sql: db.query },
      );
      if (!body.accepted) rejected++;
    }
    expect(rejected).toBe(33);
  });

  it("accepts a claim within the small rounding-convention tolerance (see file header, CLAIM_TOLERANCE_MS)", async () => {
    const genuine = loadGenuineCase(0);
    const { body } = await handleScore(
      {
        levelId: genuine.levelId,
        metric: "fastest",
        timeMs: genuine.timeMs + 6, // under the 8ms tolerance
        boostMs: genuine.boostMs,
        name: "Tester",
        tape: genuine.tape,
      },
      { sql: db.query },
    );
    expect(body.accepted).toBe(true);
  });

  it("rejects a claim just outside the tolerance", async () => {
    const genuine = loadGenuineCase(0);
    const { body } = await handleScore(
      {
        levelId: genuine.levelId,
        metric: "fastest",
        timeMs: genuine.timeMs + 9, // just over the 8ms tolerance
        boostMs: genuine.boostMs,
        name: "Tester",
        tape: genuine.tape,
      },
      { sql: db.query },
    );
    expect(body.accepted).toBe(false);
  });

  it("rejects a tape that never reaches the goal (empty tape)", async () => {
    const { body } = await handleScore(
      {
        levelId: "builtin-00",
        metric: "fastest",
        timeMs: 0,
        boostMs: 0,
        name: "Tester",
        tape: { ticks: 0, boost: [], brake: [] },
      },
      { sql: db.query },
    );
    expect(body).toEqual({ accepted: false, verified: false, reason: "no-goal" });
  });
});

describe("handleScore — hostile input rejected before verification does any real work", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb();
  });

  it("rejects a tape with more than 2000 transitions before touching the database", async () => {
    const hugeBoost = Array.from({ length: 2001 }, (_, i) => i);
    const { status, body } = await handleScore(
      {
        levelId: "builtin-00",
        metric: "fastest",
        timeMs: 1000,
        boostMs: 100,
        name: "Attacker",
        tape: { ticks: 3000, boost: hugeBoost, brake: [] },
      },
      { sql: db.query },
    );
    expect(status).toBe(400);
    expect(body.reason).toBe("invalid-tape");
    expect(db.queryLog).toHaveLength(0); // never reached resolveLevel/insert
  });

  it("rejects ticks over the 10-minute cap", async () => {
    const { status, body } = await handleScore(
      {
        levelId: "builtin-00",
        metric: "fastest",
        timeMs: 1000,
        boostMs: 0,
        name: "Attacker",
        tape: { ticks: 144 * 600 + 1, boost: [], brake: [] },
      },
      { sql: db.query },
    );
    expect(status).toBe(400);
    expect(body.reason).toBe("invalid-tape");
  });

  it("rejects NaN in timeMs (a naive Math.abs comparison would silently accept this)", async () => {
    const { status, body } = await handleScore(
      { levelId: "builtin-00", metric: "fastest", timeMs: NaN, boostMs: 0, name: "Attacker", tape: { ticks: 10, boost: [], brake: [] } },
      { sql: db.query },
    );
    expect(status).toBe(400);
    expect(body.reason).toBe("invalid-time-ms");
  });

  it("rejects Infinity in boostMs", async () => {
    const { status, body } = await handleScore(
      { levelId: "builtin-00", metric: "fastest", timeMs: 1000, boostMs: Infinity, name: "Attacker", tape: { ticks: 10, boost: [], brake: [] } },
      { sql: db.query },
    );
    expect(status).toBe(400);
    expect(body.reason).toBe("invalid-boost-ms");
  });

  it("rejects boostMs greater than timeMs (cheap sanity invariant, before verifyReplay)", async () => {
    const { status, body } = await handleScore(
      { levelId: "builtin-00", metric: "fastest", timeMs: 100, boostMs: 200, name: "Attacker", tape: { ticks: 10, boost: [], brake: [] } },
      { sql: db.query },
    );
    expect(status).toBe(400);
    expect(body.reason).toBe("boost-exceeds-time");
  });

  it("rejects SQL metacharacters in levelId with a clean 400, never reaching the database", async () => {
    const { status, body } = await handleScore(
      {
        levelId: "builtin-00'; DROP TABLE score;--",
        metric: "fastest",
        timeMs: 1000,
        boostMs: 0,
        name: "Attacker",
        tape: { ticks: 10, boost: [], brake: [] },
      },
      { sql: db.query },
    );
    expect(status).toBe(400);
    expect(body.reason).toBe("invalid-level-id");
    expect(db.queryLog).toHaveLength(0);
  });

  it("rejects SQL metacharacters in metric via the allowlist", async () => {
    const { status, body } = await handleScore(
      {
        levelId: "builtin-00",
        metric: "fastest'; DROP TABLE score;--",
        timeMs: 1000,
        boostMs: 0,
        name: "Attacker",
        tape: { ticks: 10, boost: [], brake: [] },
      },
      { sql: db.query },
    );
    expect(status).toBe(400);
    expect(body.reason).toBe("invalid-metric");
  });

  it("ACCEPTS SQL metacharacters in `name` (sanitized, then handled as a bind parameter — not a rejection case, injection defense is parameterization, not character filtering)", async () => {
    const genuine = loadGenuineCase(0);
    const { body } = await handleScore(
      {
        levelId: genuine.levelId,
        metric: "fastest",
        timeMs: genuine.timeMs,
        boostMs: genuine.boostMs,
        name: "Robert'); DROP TABLE score;--",
        tape: genuine.tape,
      },
      { sql: db.query },
    );
    expect(body.accepted).toBe(true);
    expect(db.scoreRows[0]?.player_name).toBe("Robert'); DROP TABLE score;--");
    // The table is still here — proof the "attack" was inert, stored as inert string data.
    expect(db.scoreRows).toHaveLength(1);
  });

  it("rejects a truncated/malformed tape (missing brake field)", async () => {
    const { status, body } = await handleScore(
      {
        levelId: "builtin-00",
        metric: "fastest",
        timeMs: 1000,
        boostMs: 0,
        name: "Attacker",
        tape: { ticks: 10, boost: [] }, // no `brake`
      },
      { sql: db.query },
    );
    expect(status).toBe(400);
    expect(body.reason).toBe("invalid-tape");
  });

  it("rejects a tape with a negative ticks count", async () => {
    const { status, body } = await handleScore(
      { levelId: "builtin-00", metric: "fastest", timeMs: 0, boostMs: 0, name: "Attacker", tape: { ticks: -1, boost: [], brake: [] } },
      { sql: db.query },
    );
    expect(status).toBe(400);
    expect(body.reason).toBe("invalid-tape");
  });

  it("rejects tape sent as the encoded string form instead of the frozen-contract ReplayTape object (empty-encoding hostile case)", async () => {
    const { status, body } = await handleScore(
      { levelId: "builtin-00", metric: "fastest", timeMs: 0, boostMs: 0, name: "Attacker", tape: "" },
      { sql: db.query },
    );
    expect(status).toBe(400);
    expect(body.reason).toBe("invalid-tape");
  });

  it("returns level-not-found for an unresolvable but well-formed level id, without crashing", async () => {
    const genuine = loadGenuineCase(0);
    const { status, body } = await handleScore(
      {
        levelId: "AAAAAAAAA", // well-formed, but no such custom level exists in this FakeDb
        metric: "fastest",
        timeMs: genuine.timeMs,
        boostMs: genuine.boostMs,
        name: "Tester",
        tape: genuine.tape,
      },
      { sql: db.query },
    );
    expect(status).toBe(404);
    expect(body.reason).toBe("level-not-found");
  });

  it("rejects a malformed top-level body (not an object)", async () => {
    const { status, body } = await handleScore("just a string", { sql: db.query });
    expect(status).toBe(400);
    expect(body.reason).toBe("malformed-body");
  });
});

describe("rate limiting — the actual configured score submission limiter", () => {
  beforeEach(() => {
    scoreRateLimiter.reset();
  });

  it(`allows exactly ${SCORE_RATE_LIMIT.limit} submissions then 429s the rest, firing 50 in a simulated 10s window (task's own verification scenario)`, () => {
    const ip = "198.51.100.7";
    const start = Date.now();
    const results = Array.from({ length: 50 }, (_, i) => {
      const now = start + Math.floor((i * 10_000) / 50); // spread across a simulated 10s window
      return scoreRateLimiter.check(ip, now);
    });

    const allowed = results.filter((r) => r.allowed).length;
    const limited = results.filter((r) => !r.allowed).length;

    expect(allowed).toBe(SCORE_RATE_LIMIT.limit);
    expect(limited).toBe(50 - SCORE_RATE_LIMIT.limit);
    expect(limited).toBeGreaterThan(0); // proves it actually triggers, not just "would in theory"
  });

  it("does not rate-limit a different source IP once one IP is limited", () => {
    const start = Date.now();
    for (let i = 0; i < SCORE_RATE_LIMIT.limit + 5; i++) {
      scoreRateLimiter.check("attacker-ip", start + i);
    }
    expect(scoreRateLimiter.check("attacker-ip", start + 1000).allowed).toBe(false);
    expect(scoreRateLimiter.check("someone-else-ip", start + 1000).allowed).toBe(true);
  });
});

// Sanity check that levelId() cross-checking in resolveLevel actually matters: confirms the round
// trip for every real builtin index, since resolveLevel refuses to trust a regex match alone.
describe("resolveLevel cross-checks with @swingby/core's own levelId()", () => {
  it("agrees with levelId(index) for every built-in level", async () => {
    const db = new FakeDb();
    for (let i = 0; i < BUILTIN_LEVELS.length; i++) {
      const id = levelId(i);
      const level = await resolveLevel(db.query, id);
      expect(level).toBe(BUILTIN_LEVELS[i]);
    }
  });
});
