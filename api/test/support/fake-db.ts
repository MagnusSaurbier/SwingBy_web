/**
 * T-12 LEDGER test support — a thin, HONEST in-memory fake of the `QueryFn` seam in `api/_db.ts`.
 *
 * "Honest" here means: this does NOT special-case per-test expectations or hardcode what a given
 * call "should" return. It recognizes the finite, fixed set of literal query templates `_db.ts`
 * actually emits (there are exactly eight — see the branches below, one per exported data-access
 * function) and, for each, independently computes the real answer against an in-memory row store —
 * filtering by `level_id`, sorting verified-first-then-metric exactly as the SQL's `ORDER BY`
 * clause says, enforcing the `custom_level` primary-key uniqueness a real Postgres constraint would
 * enforce (raising the same `{code: "23505"}` shape `@neondatabase/serverless`'s `NeonDbError`
 * carries) — rather than returning canned data shaped to make a specific test pass. A bug in
 * `_db.ts`'s SQL text and a bug in this file's independent re-implementation of the same logic are
 * unlikely to be the same bug, which is what makes exercising the real route handlers against this
 * worth more than mocking `insertScore`/`fetchLeaderboard`/etc directly.
 *
 * Deliberately NOT a general SQL engine — it does not parse arbitrary SQL, only recognizes the
 * specific templates this codebase's `_db.ts` produces (matched by normalized-whitespace, lowercase
 * prefix/substring checks). An unrecognized query throws loudly rather than silently returning `[]`,
 * so a `_db.ts` change that isn't mirrored here fails the test suite instead of passing vacuously.
 */

import type { QueryFn, Row } from "../../_db.js";

export function makeUniqueViolation(): Error {
  const err = new Error("duplicate key value violates unique constraint") as Error & { code: string };
  err.code = "23505";
  return err;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export class FakeDb {
  readonly scoreRows: Row[] = [];
  readonly customLevelRows: Row[] = [];
  private nextScoreId = 1;
  /** Every query text this instance was asked to run, in order — lets a test assert that a
   *  rejection path never even reached the database (e.g. malformed input rejected pre-insert). */
  readonly queryLog: string[] = [];

  readonly query: QueryFn = async (text: string, params: readonly unknown[] = []): Promise<Row[]> => {
    this.queryLog.push(text);
    const n = normalize(text);

    if (n.startsWith("insert into score")) return this.insertScore(params);
    if (n.startsWith("insert into custom_level")) return this.insertCustomLevel(params);
    if (n.includes("from score") && n.includes("row_number()")) return this.leaderboard(n, params);
    if (n.startsWith("select count(*)::int as n from score")) return this.scoreCount(n, params);
    if (n.startsWith("select id, name, author, data, plays, created_at from custom_level where id")) {
      return this.fetchCustomLevel(params);
    }
    if (n.startsWith("select id, name, author, plays from custom_level")) return this.listLevels(n, params);

    throw new Error(`FakeDb: unrecognized query, add a branch or fix _db.ts: ${text}`);
  };

  private insertScore(params: readonly unknown[]): Row[] {
    const [levelId, playerName, timeMs, boostMs, tape, verified] = params;
    const row: Row = {
      id: this.nextScoreId++,
      level_id: levelId,
      player_name: playerName,
      time_ms: timeMs,
      boost_ms: boostMs,
      tape,
      verified,
      created_at: new Date().toISOString(),
    };
    this.scoreRows.push(row);
    return [{ id: row.id, created_at: row.created_at }];
  }

  private insertCustomLevel(params: readonly unknown[]): Row[] {
    const [id, name, author, dataJson] = params;
    if (this.customLevelRows.some((r) => r.id === id)) {
      throw makeUniqueViolation();
    }
    this.customLevelRows.push({
      id,
      name,
      author,
      data: JSON.parse(String(dataJson)) as unknown,
      plays: 0,
      created_at: new Date().toISOString(),
    });
    return [];
  }

  private leaderboard(normalized: string, params: readonly unknown[]): Row[] {
    const [levelId, limit] = params as [string, number];
    const metricCol: "time_ms" | "boost_ms" = normalized.includes("boost_ms asc") ? "boost_ms" : "time_ms";

    const sorted = this.scoreRows
      .filter((r) => r.level_id === levelId)
      .slice()
      .sort((a, b) => {
        const av = a.verified ? 1 : 0;
        const bv = b.verified ? 1 : 0;
        if (av !== bv) return bv - av; // verified first, unconditionally
        return (a[metricCol] as number) - (b[metricCol] as number);
      });

    return sorted.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
  }

  private scoreCount(normalized: string, params: readonly unknown[]): Row[] {
    const levelId = params[0] as string;
    const value = params[1] as number | undefined;
    const wantVerified = normalized.includes("verified = true");

    let rows = this.scoreRows.filter(
      (r) => r.level_id === levelId && Boolean(r.verified) === wantVerified,
    );

    if (value !== undefined) {
      const col: "time_ms" | "boost_ms" | null = normalized.includes("boost_ms <")
        ? "boost_ms"
        : normalized.includes("time_ms <")
          ? "time_ms"
          : null;
      if (col) rows = rows.filter((r) => (r[col] as number) < value);
    }

    return [{ n: rows.length }];
  }

  private fetchCustomLevel(params: readonly unknown[]): Row[] {
    const id = params[0];
    const row = this.customLevelRows.find((r) => r.id === id);
    return row ? [row] : [];
  }

  private listLevels(normalized: string, params: readonly unknown[]): Row[] {
    const limit = params[0] as number;
    const sortByPlays = normalized.includes("order by plays desc");

    const sorted = this.customLevelRows.slice().sort((a, b) => {
      if (sortByPlays) {
        const diff = (b.plays as number) - (a.plays as number);
        if (diff !== 0) return diff;
      }
      return new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime();
    });

    return sorted.slice(0, limit);
  }
}
