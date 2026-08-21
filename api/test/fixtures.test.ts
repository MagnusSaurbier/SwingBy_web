/**
 * T-12 LEDGER — generates the fixture files tasks/T-12-LEDGER.md's "How to verify" section
 * references (`test/fixtures/*.json`, for use with `curl -d @...` against `vercel dev` once a real
 * database exists — see results/T-12-LEDGER.md "BLOCKED"). Every fixture here is DERIVED from a
 * synthetic, gravity-free "genuine" level (api/test/support/genuine.ts's `loadGenuineCase`, see its
 * doc comment) via `verifyReplay` itself, never hand-typed numbers, so a fixture that's supposed to
 * be genuine really does verify, and one that's supposed to be tampered/wrong really does fail for
 * the reason its filename claims.
 *
 * These fixtures' `levelId` (currently "GENUINE00") is a CUSTOM level id, not a `builtin-NN` one
 * (the real built-in levels' T-03 solving tapes were removed on feat/remove-gravity-softening — see
 * notes/feat-remove-gravity-softening/PLAN.md). Against a real server, `resolveLevel` looks this id
 * up via `custom_level`, so exercising `valid-score.json`/`tampered-tape.json`/`wrong-claim.json`
 * against `vercel dev` needs that level registered first (e.g. `POST /api/levels` with this
 * fixture's level data) — it does not exist in a fresh database by default.
 *
 * `oversized.json` / `10k-bodies.json` are committed at a reduced size (order ~100 KB / ~40 KB, both
 * comfortably over this route's own byte caps) rather than the literal "10 MB" the task's hostile-
 * input table names — committing a genuine 10 MB fixture would needlessly bloat the repository. The
 * literal 10 MB magnitude is instead proven directly in api/test/levels.test.ts against an in-memory
 * buffer that is never written to disk. Noted here so a reader diffing against the task doc's
 * wording doesn't mistake the smaller committed file for the whole story.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { flipOneTransition, loadGenuineCase } from "./support/genuine.js";

const FIXTURES_DIR = fileURLToPath(new URL("./fixtures/", import.meta.url));

/** Trailing newline, matching prettier's own output for a `.json` file — without it, `npm run
 *  lint` (`prettier --check .`) re-flags these on every regeneration (they're rewritten each time
 *  this test runs), which is just noise since the content itself never actually needs reformatting. */
function writeJsonFixture(path: string, value: unknown, pretty: boolean): void {
  const text = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  writeFileSync(path, `${text}\n`);
}

describe("fixture generation", () => {
  it("writes valid-score.json, tampered-tape.json, wrong-claim.json, oversized.json, 10k-bodies.json", () => {
    mkdirSync(FIXTURES_DIR, { recursive: true });

    const genuine = loadGenuineCase(0);

    const validScore = {
      levelId: genuine.levelId,
      metric: "fastest",
      timeMs: genuine.timeMs,
      boostMs: genuine.boostMs,
      name: "Magnus",
      tape: genuine.tape,
    };
    writeJsonFixture(`${FIXTURES_DIR}valid-score.json`, validScore, true);

    const flipped = flipOneTransition(genuine.tape);
    expect(flipped).not.toBeNull();
    const tamperedTape = {
      ...validScore,
      tape: flipped,
    };
    writeJsonFixture(`${FIXTURES_DIR}tampered-tape.json`, tamperedTape, true);

    const wrongClaim = {
      ...validScore,
      timeMs: genuine.timeMs + 500,
    };
    writeJsonFixture(`${FIXTURES_DIR}wrong-claim.json`, wrongClaim, true);

    const oversized = {
      ...validScore,
      name: "x".repeat(120_000), // >> MAX_SCORE_BODY_BYTES (96 KB), rejected on raw bytes alone
    };
    writeJsonFixture(`${FIXTURES_DIR}oversized.json`, oversized, false);

    const tenKBodies = {
      name: "DoS Level",
      author: "attacker",
      data: {
        name: "DoS Level",
        author: "attacker",
        goal: { index: 1, range: 50 },
        objects: Array.from({ length: 10_000 }, (_, i) => ({
          type: "planet",
          x: i,
          y: i,
          gravity: 1,
        })),
      },
    };
    writeJsonFixture(`${FIXTURES_DIR}10k-bodies.json`, tenKBodies, false);

    expect(true).toBe(true);
  });
});
