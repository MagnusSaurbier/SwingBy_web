/**
 * T-12 LEDGER — GET /api/leaderboard (INTERFACES.md#api--t-12-ledger, frozen).
 *
 *   GET /api/leaderboard?level=<id>&metric=fastest|efficient&limit=50
 *     -> { entries: [{ rank, name, timeMs, boostMs, verified, createdAt }] }
 *
 * Read-only. Not rate-limited (see results/T-12-LEDGER.md "Rate limiting" for the explicit scope
 * decision) — every query here is an indexed, `LIMIT`-bounded `SELECT`; the abuse surface this task
 * is guarding is the public *write* endpoints, per tasks/T-12-LEDGER.md "Abuse surface".
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  DbConfigError,
  fetchLeaderboard,
  getSql,
  type LeaderboardEntry,
  type QueryFn,
} from "./_db.js";
import {
  isValidLevelIdFormat,
  parseLimit,
  parseMetric,
  DEFAULT_LEADERBOARD_LIMIT,
  MAX_LEADERBOARD_LIMIT,
} from "./_validate.js";

export interface LeaderboardResponseBody {
  entries: LeaderboardEntry[];
}

type QueryValue = string | string[] | undefined;

function first(value: QueryValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Core logic, independent of the HTTP transport — directly testable with a fake `QueryFn` and a
 *  plain query-param object, no HTTP server required. */
export async function handleLeaderboard(
  query: Record<string, QueryValue>,
  sql: QueryFn,
): Promise<{
  status: number;
  body: LeaderboardResponseBody | { error: string };
}> {
  const levelId = first(query.level);
  if (!isValidLevelIdFormat(levelId)) {
    return { status: 400, body: { error: "invalid-level-id" } };
  }

  const metric = parseMetric(first(query.metric));
  if (metric === null) {
    return { status: 400, body: { error: "invalid-metric" } };
  }

  const limit = parseLimit(
    first(query.limit),
    DEFAULT_LEADERBOARD_LIMIT,
    MAX_LEADERBOARD_LIMIT,
  );

  const entries = await fetchLeaderboard(sql, levelId, metric, limit);
  return { status: 200, body: { entries } };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method-not-allowed" });
    return;
  }

  let sql: QueryFn;
  try {
    sql = getSql();
  } catch (err) {
    const error =
      err instanceof DbConfigError ? err.message : "database-unavailable";
    res.status(500).json({ error });
    return;
  }

  const { status, body } = await handleLeaderboard(req.query, sql);
  res.status(status).json(body);
}
