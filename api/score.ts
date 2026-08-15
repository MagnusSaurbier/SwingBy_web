/**
 * T-12 LEDGER — POST /api/score (INTERFACES.md#api--t-12-ledger, frozen).
 *
 *   POST /api/score
 *     { levelId, metric, timeMs, boostMs, name, tape }
 *     -> { accepted: boolean, verified: boolean, rank?: number, reason?: string }
 *
 * This is the entire point of the task: `verifyReplay` (the exact code that ran in the player's
 * browser, per PROJECT.md §3) runs server-side before anything is trusted. The claimed `timeMs`/
 * `boostMs` are NEVER written as-is — the row this function inserts always uses the server's own
 * simulated `timeMs`/`boostMs` from the `VerifyResult`, not the client's claim. The claim is only
 * ever used as a comparison target (with a small tolerance — see below), never as data.
 *
 * `handleScore` is the directly-testable core (pure of HTTP/DB-wiring concerns beyond the injected
 * `QueryFn`); `export default` is the thin Vercel adapter around it. This split is what lets
 * `api/test/**` exercise every validation/verification/ranking branch without a real HTTP server.
 */

import { verifyReplay, BUILTIN_LEVELS, levelId as builtinLevelId } from "@swingby/core";
import type { Level, ReplayTape } from "@swingby/core";
import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  computeRank,
  fetchCustomLevel,
  getSql,
  insertScore,
  DbConfigError,
  type QueryFn,
} from "./_db.js";
import {
  isFiniteNumberInRange,
  isPlainObject,
  isValidLevelIdFormat,
  parseMetric,
  readJsonBody,
  sanitizeName,
  MAX_SCORE_BODY_BYTES,
  type Metric,
} from "./_validate.js";
import { getClientIp, scoreRateLimiter } from "./_ratelimit.js";

// Vercel serverless functions default to a platform body parser with a ~4.5 MB ceiling — far above
// what this route should ever accept. Opting out and reading the stream ourselves (readJsonBody) is
// what makes the size cap apply to bytes actually received, not to whatever JSON.parse produced.
export const config = { api: { bodyParser: false } };

/** `tape.ticks` is capped at 10 minutes (144*600) by `@swingby/core`'s own `MAX_TAPE_TICKS` — a
 *  claimed time can never legitimately exceed that horizon either, so the same figure bounds the
 *  claim fields too. Kept as a literal here (not imported) because `MAX_TAPE_TICKS` is a *tick*
 *  count and this is independently checking a *millisecond* claim — see the malformed-tape
 *  handling inside `@swingby/core/replay.ts` for the tick-side bound, which still runs regardless. */
const MAX_CLAIM_MS = 600_000;

/** One tick is 1000/144 ≈ 6.94 ms. `verifyReplay`'s default tolerance is zero, but T-02's own log
 *  (notes/T-02-TAPE/log.md, 2026-08-13T00:00Z point 2) flags a real, undecided risk: a client that
 *  computes `timeMs` via `floor` instead of `round` (or otherwise rounds differently than the
 *  server's `Math.round(ticks * 1000/144)`) would have a genuine run rejected purely on a rounding
 *  convention mismatch, not a replay discrepancy. 8ms absorbs a one-tick rounding difference in
 *  either direction without giving a forger anything meaningful (sub-tick timing has no gameplay
 *  significance — ticks are the durable unit, PROJECT.md §4). */
const CLAIM_TOLERANCE_MS = 8;

export interface ScoreResponseBody {
  accepted: boolean;
  verified: boolean;
  rank?: number;
  reason?: string;
}

interface ParsedScoreRequest {
  levelId: string;
  metric: Metric;
  timeMs: number;
  boostMs: number;
  name: string;
  tape: ReplayTape;
}

function badRequest(reason: string): { status: number; body: ScoreResponseBody } {
  return { status: 400, body: { accepted: false, verified: false, reason } };
}

/**
 * Cheap shape/bounds check on the tape BEFORE `verifyReplay` runs — not because `verifyReplay`
 * fails to guard itself (it does, thoroughly: see `findMalformedReason` in
 * packages/core/src/replay.ts), but because this route's own contract ("Bound everything before
 * doing work") should hold independently of a dependency's internals, and because it lets a
 * grossly-oversized `boost`/`brake` array fail on an O(1) `.length` check rather than even entering
 * `@swingby/core`. Does not duplicate the full element-by-element validation (finite, strictly
 * increasing, in-range) — that stays `verifyReplay`'s job, once shape is already sane.
 */
function isPlausibleTapeShape(raw: unknown): raw is ReplayTape {
  if (!isPlainObject(raw)) return false;
  const ticks = raw.ticks;
  if (typeof ticks !== "number" || !Number.isInteger(ticks) || ticks < 0 || ticks > 144 * 600) {
    return false;
  }
  const boost = raw.boost;
  const brake = raw.brake;
  if (!Array.isArray(boost) || !Array.isArray(brake)) return false;
  if (boost.length + brake.length > 2000) return false;
  return true;
}

function parseScoreRequest(rawBody: unknown): ParsedScoreRequest | { error: string } {
  if (!isPlainObject(rawBody)) return { error: "malformed-body" };

  const levelId = rawBody.levelId;
  if (!isValidLevelIdFormat(levelId)) return { error: "invalid-level-id" };

  const metric = parseMetric(rawBody.metric);
  if (metric === null) return { error: "invalid-metric" };

  const timeMs = rawBody.timeMs;
  if (!isFiniteNumberInRange(timeMs, 0, MAX_CLAIM_MS)) return { error: "invalid-time-ms" };

  const boostMs = rawBody.boostMs;
  if (!isFiniteNumberInRange(boostMs, 0, MAX_CLAIM_MS)) return { error: "invalid-boost-ms" };

  // Cheap sanity invariant: you cannot have boosted for longer than the run took. `verifyReplay`
  // would also catch a claim like this (as a boost-mismatch, once simulated), but this is free.
  if (boostMs > timeMs) return { error: "boost-exceeds-time" };

  const name = sanitizeName(rawBody.name);
  if (name === null) return { error: "invalid-name" };

  const tape = rawBody.tape;
  if (!isPlausibleTapeShape(tape)) return { error: "invalid-tape" };

  return { levelId, metric, timeMs, boostMs, name, tape };
}

/** Resolves a `levelId` to the `Level` it names: `builtin-NN` indexes straight into
 *  `BUILTIN_LEVELS` (cross-checked with `levelId()` round-tripping back to the same string, so a
 *  format that merely *looks* like a builtin id can never silently alias a different index);
 *  anything else is looked up in `custom_level`. Returns `null` for anything that resolves to
 *  nothing — never throws. */
export async function resolveLevel(sql: QueryFn, id: string): Promise<Level | null> {
  const m = /^builtin-(\d{2})$/.exec(id);
  if (m) {
    const index = Number(m[1]);
    const candidate = BUILTIN_LEVELS[index];
    if (candidate !== undefined && builtinLevelId(index) === id) {
      return candidate;
    }
    return null;
  }

  const row = await fetchCustomLevel(sql, id);
  if (!row) return null;
  return row.data as Level;
}

/**
 * Core logic, independent of the HTTP transport. `rawBody` is whatever `JSON.parse` produced from
 * the request (already size-bounded by the caller via `readJsonBody`) — fully untrusted otherwise.
 */
export async function handleScore(
  rawBody: unknown,
  ctx: { sql: QueryFn },
): Promise<{ status: number; body: ScoreResponseBody }> {
  const parsed = parseScoreRequest(rawBody);
  if ("error" in parsed) return badRequest(parsed.error);

  const level = await resolveLevel(ctx.sql, parsed.levelId);
  if (level === null) {
    return { status: 404, body: { accepted: false, verified: false, reason: "level-not-found" } };
  }

  // The trust boundary. Server-side, using the exact same `@swingby/core` code the browser ran
  // (PROJECT.md §3) — never a second implementation. The claim is a comparison target, not data.
  const result = verifyReplay(
    level,
    parsed.tape,
    { timeMs: parsed.timeMs, boostMs: parsed.boostMs },
    { timeMs: CLAIM_TOLERANCE_MS, boostMs: CLAIM_TOLERANCE_MS },
  );

  if (!result.ok) {
    // See notes/T-12-LEDGER/log.md decision 1: reject outright rather than storing an unverified
    // row. `reason` mirrors `VerifyResult.reason` (no-goal / out-of-bounds / time-mismatch /
    // boost-mismatch / malformed) so the client can distinguish "you didn't actually finish" from
    // "the numbers don't add up" if it ever wants to.
    return {
      status: 200,
      body: { accepted: false, verified: false, reason: result.reason ?? "verification-failed" },
    };
  }

  // Recomputed values only — never the client's claim (see file header).
  const metricValue = parsed.metric === "fastest" ? result.timeMs : result.boostMs;

  const inserted = await insertScore(ctx.sql, {
    levelId: parsed.levelId,
    playerName: parsed.name,
    timeMs: result.timeMs,
    boostMs: result.boostMs,
    tape: JSON.stringify({ ticks: parsed.tape.ticks, boost: parsed.tape.boost, brake: parsed.tape.brake }),
    verified: true,
  });
  void inserted; // id/createdAt not part of the frozen response shape; kept for future use.

  const rank = await computeRank(ctx.sql, parsed.levelId, parsed.metric, true, metricValue);

  return { status: 200, body: { accepted: true, verified: true, rank } };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ accepted: false, verified: false, reason: "method-not-allowed" });
    return;
  }

  const ip = getClientIp(req);
  const limit = scoreRateLimiter.check(ip);
  if (!limit.allowed) {
    res.setHeader("Retry-After", Math.ceil(limit.retryAfterMs / 1000).toString());
    res.status(429).json({ accepted: false, verified: false, reason: "rate-limited" });
    return;
  }

  const parsedBody = await readJsonBody(req, MAX_SCORE_BODY_BYTES);
  if (!parsedBody.ok) {
    res.status(400).json({ accepted: false, verified: false, reason: parsedBody.error });
    return;
  }

  let sql: QueryFn;
  try {
    sql = getSql();
  } catch (err) {
    const reason = err instanceof DbConfigError ? err.message : "database-unavailable";
    res.status(500).json({ accepted: false, verified: false, reason });
    return;
  }

  const { status, body } = await handleScore(parsedBody.value, { sql });
  res.status(status).json(body);
}
