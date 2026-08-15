/**
 * T-12 LEDGER — GET/POST /api/levels, GET /api/levels/:id.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { handleLevelsCreate, handleLevelsList } from "../levels/index.js";
import { handleLevelGet } from "../levels/[id].js";
import { readJsonBody, MAX_LEVEL_BODY_BYTES } from "../_validate.js";
import { FakeDb } from "./support/fake-db.js";

const VALID_DATA = {
  goal: { index: 1, range: 50 },
  objects: [
    { type: "player", x: 0, y: 0, gravity: 0 },
    { type: "sun", x: 500, y: 500, gravity: 1000 },
  ],
};

describe("handleLevelsCreate", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb();
  });

  it("creates a level and returns its id", async () => {
    const { status, body } = await handleLevelsCreate(
      { name: "My Level", author: "Magnus", data: VALID_DATA },
      db.query,
    );
    expect(status).toBe(200);
    expect("id" in body).toBe(true);
    if ("id" in body) {
      expect(typeof body.id).toBe("string");
      expect(body.id.length).toBeGreaterThanOrEqual(8);
    }
  });

  it("stores the canonical top-level name/author into `data`, discarding whatever data.name/data.author the client sent (decision 5)", async () => {
    const { body } = await handleLevelsCreate(
      {
        name: "Canonical Name",
        author: "Canonical Author",
        data: { ...VALID_DATA, name: "Spoofed Name", author: "Spoofed Author" },
      },
      db.query,
    );
    expect("id" in body).toBe(true);
    if ("id" in body) {
      const stored = db.customLevelRows.find((r) => r.id === body.id);
      expect(stored?.name).toBe("Canonical Name");
      const storedData = stored?.data as { name: string; author: string };
      expect(storedData.name).toBe("Canonical Name");
      expect(storedData.author).toBe("Canonical Author");
    }
  });

  it("rejects a level that fails @swingby/core's validate() (e.g. no player object)", async () => {
    const { status, body } = await handleLevelsCreate(
      {
        name: "Bad Level",
        author: "x",
        data: {
          goal: { index: 0, range: 10 },
          objects: [{ type: "sun", x: 0, y: 0, gravity: 1 }],
        },
      },
      db.query,
    );
    expect(status).toBe(400);
    expect("error" in body).toBe(true);
    if ("error" in body) expect(body.error).toContain("invalid-level");
    expect(db.customLevelRows).toHaveLength(0);
  });

  it("rejects the '10,000 bodies' DoS shape by object count, BEFORE validate() ever runs", async () => {
    const objects = Array.from({ length: 10_000 }, (_, i) => ({
      type: "planet",
      x: i,
      y: i,
      gravity: 1,
    }));
    const { status, body } = await handleLevelsCreate(
      {
        name: "DoS Level",
        author: "attacker",
        data: { goal: { index: 1, range: 50 }, objects },
      },
      db.query,
    );
    expect(status).toBe(400);
    expect("error" in body).toBe(true);
    if ("error" in body) expect(body.error).toBe("too-many-objects");
    expect(db.queryLog).toHaveLength(0); // never reached insertCustomLevel
  });

  it("rejects a missing/non-object data field", async () => {
    const { status } = await handleLevelsCreate(
      { name: "x", author: "y", data: "not an object" },
      db.query,
    );
    expect(status).toBe(400);
  });

  it("rejects an empty/invalid name or author", async () => {
    const r1 = await handleLevelsCreate(
      { name: "", author: "y", data: VALID_DATA },
      db.query,
    );
    expect(r1.status).toBe(400);
    const r2 = await handleLevelsCreate(
      { name: "x", author: "", data: VALID_DATA },
      db.query,
    );
    expect(r2.status).toBe(400);
  });

  it("truncates an oversized name/author rather than rejecting (sanitizeName caps length)", async () => {
    const { status, body } = await handleLevelsCreate(
      { name: "x".repeat(500), author: "y".repeat(500), data: VALID_DATA },
      db.query,
    );
    expect(status).toBe(200);
    if ("id" in body) {
      const stored = db.customLevelRows.find((r) => r.id === body.id);
      expect((stored?.name as string).length).toBe(48); // MAX_LEVEL_NAME_LEN
      expect((stored?.author as string).length).toBe(32); // MAX_LEVEL_AUTHOR_LEN
    }
  });

  it("rejects a malformed top-level body", async () => {
    const { status } = await handleLevelsCreate("not an object", db.query);
    expect(status).toBe(400);
  });
});

describe("handleLevelsList", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb();
  });

  it("returns the frozen response shape { levels: [{ id, name, author, plays }] }", async () => {
    await handleLevelsCreate(
      { name: "L1", author: "A", data: VALID_DATA },
      db.query,
    );
    const { status, body } = await handleLevelsList({}, db.query);
    expect(status).toBe(200);
    expect("levels" in body).toBe(true);
    if ("levels" in body) {
      expect(body.levels).toHaveLength(1);
      expect(body.levels[0]).toMatchObject({
        name: "L1",
        author: "A",
        plays: 0,
      });
      expect(typeof body.levels[0]?.id).toBe("string");
    }
  });

  it("defaults to sort=new when sort is omitted or invalid", async () => {
    const { status } = await handleLevelsList(
      { sort: "nonsense; DROP TABLE custom_level;--" },
      db.query,
    );
    expect(status).toBe(200); // falls back to the default rather than erroring
  });

  it("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await handleLevelsCreate(
        { name: `L${i}`, author: "A", data: VALID_DATA },
        db.query,
      );
    }
    const { body } = await handleLevelsList({ limit: "2" }, db.query);
    if ("levels" in body) expect(body.levels).toHaveLength(2);
    else throw new Error("expected levels");
  });
});

describe("handleLevelGet", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = new FakeDb();
  });

  it("returns { id, name, author, data } for an existing level", async () => {
    const created = await handleLevelsCreate(
      { name: "L1", author: "A", data: VALID_DATA },
      db.query,
    );
    if (!("id" in created.body)) throw new Error("expected id");

    const { status, body } = await handleLevelGet(created.body.id, db.query);
    expect(status).toBe(200);
    expect("id" in body).toBe(true);
    if ("id" in body) {
      expect(body.id).toBe(created.body.id);
      expect(body.name).toBe("L1");
      expect(body.author).toBe("A");
      expect(body.data).toBeDefined();
    }
  });

  it("returns 404 for a nonexistent, well-formed id", async () => {
    const { status, body } = await handleLevelGet("NOSUCHID1", db.query);
    expect(status).toBe(404);
    expect("error" in body).toBe(true);
  });

  it("rejects an id containing SQL metacharacters with a clean 400, never touching the database", async () => {
    const { status } = await handleLevelGet(
      "'; DROP TABLE custom_level;--",
      db.query,
    );
    expect(status).toBe(400);
    expect(db.queryLog).toHaveLength(0);
  });

  it("rejects a non-string id (e.g. array query param)", async () => {
    const { status } = await handleLevelGet(["a", "b"], db.query);
    expect(status).toBe(400);
  });
});

describe("readJsonBody against MAX_LEVEL_BODY_BYTES — the literal '10 MB level payload' hostile case", () => {
  it("rejects a genuinely ~10 MB in-memory payload before JSON.parse runs, never committed to disk", async () => {
    const tenMb = "x".repeat(10 * 1024 * 1024);
    const payload = JSON.stringify({
      name: "x",
      author: "y",
      data: { goal: {}, objects: [], filler: tenMb },
    });
    expect(Buffer.byteLength(payload, "utf8")).toBeGreaterThan(
      10 * 1024 * 1024,
    );

    const { Readable } = await import("node:stream");
    const stream = Readable.from([
      Buffer.from(payload, "utf8"),
    ]) as unknown as Parameters<typeof readJsonBody>[0];
    stream.headers = {};

    const result = await readJsonBody(stream, MAX_LEVEL_BODY_BYTES);
    expect(result).toEqual({ ok: false, error: "too-large" });
  });

  it("rejects the same payload immediately via a (correct) Content-Length header, without reading 10 MB into memory at all", async () => {
    const { Readable } = await import("node:stream");
    const stream = Readable.from([Buffer.alloc(0)]) as unknown as Parameters<
      typeof readJsonBody
    >[0];
    stream.headers = { "content-length": String(10 * 1024 * 1024) };

    const result = await readJsonBody(stream, MAX_LEVEL_BODY_BYTES);
    expect(result).toEqual({ ok: false, error: "too-large" });
  });
});
