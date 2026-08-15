/**
 * T-12 LEDGER — shared database access.
 *
 * Production wiring uses `@neondatabase/serverless`'s `neon()` HTTP driver (task doc + DESIGN.md
 * §8: a raw TCP connection from a serverless function exhausts Postgres's connection pool under any
 * real concurrency, and that failure mode only shows up under load — Neon's HTTP driver sidesteps it
 * entirely by not holding a connection open between requests).
 *
 * Every function below takes a `QueryFn` as its first argument rather than reaching for a module-
 * level singleton, specifically so `api/test/**` can inject a thin in-memory fake of the *exact same
 * shape* `neon(url)` itself satisfies when called in "ordinary function" mode — confirmed against
 * `node_modules/@neondatabase/serverless/index.d.ts`: `sql(text, params)` (no template literal)
 * returns rows directly, using `$1`/`$2` placeholders. See notes/T-12-LEDGER/log.md for why this
 * container cannot exercise the real HTTP driver end-to-end (no Neon account, and no local
 * Neon-protocol-compatible gateway), and results/T-12-LEDGER.md for what a real local Postgres 16
 * *was* used for instead (schema application + EXPLAIN).
 *
 * SQL text is never composed by string interpolation of any request-derived value, including values
 * already checked against an allowlist (`Metric`, `LevelsSort`) — every query that varies by one of
 * those is written out as a complete, separate literal string per branch (see `leaderboardQuery`,
 * `rankVerifiedQuery`, `rankUnverifiedQuery`, `listLevelsQuery`). The only things that ever cross the
 * SQL boundary as data are bind parameters.
 */

import { neon } from "@neondatabase/serverless";

import type { LevelsSort, Metric } from "./_validate.js";

// ---------------------------------------------------------------------------
// QueryFn — the seam. Production: a thin wrapper around `neon(url)`. Tests: an in-memory fake.
// ---------------------------------------------------------------------------

export type Row = Record<string, unknown>;

export interface QueryFn {
  (text: string, params?: readonly unknown[]): Promise<Row[]>;
}

export class DbConfigError extends Error {
  constructor() {
    super("DATABASE_URL is not set (infra/DEPLOY.md §5) — cannot reach the database");
    this.name = "DbConfigError";
  }
}

let cachedSql: QueryFn | null = null;

/** Lazily constructs and caches the real Neon HTTP query function. Throws `DbConfigError` rather
 *  than crashing opaquely when `DATABASE_URL` is unset — this container never has it set (see log),
 *  so this function is intentionally never exercised by `api/test/**`; routes call it only in the
 *  `export default` Vercel adapter, never from the directly-tested `handleXxx` core functions. */
export function getSql(): QueryFn {
  if (cachedSql) return cachedSql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new DbConfigError();
  const neonSql = neon(url);
  cachedSql = (text, params) => neonSql(text, params ? Array.from(params) : []) as Promise<Row[]>;
  return cachedSql;
}

/** `timestamptz` columns may come back from the driver as a `Date` (node-postgres-style type
 *  parsing) or as a string, depending on driver configuration. Handles both so callers never have to
 *  care which. */
function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return String(value);
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

// ---------------------------------------------------------------------------
// score
// ---------------------------------------------------------------------------

export interface ScoreInsert {
  levelId: string;
  playerName: string;
  timeMs: number;
  boostMs: number;
  /** `JSON.stringify`'d `ReplayTape`, or `null`. See notes/T-12-LEDGER/log.md decision 1 — the
   *  normal submit path (api/score.ts) only ever inserts verified rows with a tape attached; `null`
   *  exists for schema forward-compatibility (e.g. a future bulk import of legacy local scores). */
  tape: string | null;
  verified: boolean;
}

export interface ScoreInsertResult {
  id: number;
  createdAt: string;
}

export async function insertScore(sql: QueryFn, row: ScoreInsert): Promise<ScoreInsertResult> {
  const rows = await sql(
    `insert into score (level_id, player_name, time_ms, boost_ms, tape, verified)
     values ($1, $2, $3, $4, $5, $6)
     returning id, created_at`,
    [row.levelId, row.playerName, row.timeMs, row.boostMs, row.tape, row.verified],
  );
  const first = rows[0];
  if (!first) throw new Error("insertScore: insert returned no row");
  return { id: Number(first.id), createdAt: toIsoString(first.created_at) };
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  timeMs: number;
  boostMs: number;
  verified: boolean;
  createdAt: string;
}

/** Verified rows always sort before unverified ones, regardless of metric value — the whole point
 *  of this task (INTERFACES.md ".. must never outrank verified"). Each branch is a complete literal
 *  query; `metric` never gets composed into SQL text. See `infra/schema.sql` for the matching index
 *  design (`(level_id, verified desc, time_ms|boost_ms)`), and results/T-12-LEDGER.md for the real
 *  `EXPLAIN ANALYZE` output proving this is a single index scan, not a sequential scan + sort. */
function leaderboardQuery(metric: Metric): string {
  switch (metric) {
    case "fastest":
      return `select player_name, time_ms, boost_ms, verified, created_at,
                      row_number() over (order by verified desc, time_ms asc) as rank
               from score
               where level_id = $1
               order by verified desc, time_ms asc
               limit $2`;
    case "efficient":
      return `select player_name, time_ms, boost_ms, verified, created_at,
                      row_number() over (order by verified desc, boost_ms asc) as rank
               from score
               where level_id = $1
               order by verified desc, boost_ms asc
               limit $2`;
  }
}

export async function fetchLeaderboard(
  sql: QueryFn,
  levelId: string,
  metric: Metric,
  limit: number,
): Promise<LeaderboardEntry[]> {
  const rows = await sql(leaderboardQuery(metric), [levelId, limit]);
  return rows.map((r) => ({
    rank: Number(r.rank),
    name: String(r.player_name),
    timeMs: Number(r.time_ms),
    boostMs: Number(r.boost_ms),
    verified: Boolean(r.verified),
    createdAt: toIsoString(r.created_at),
  }));
}

function rankVerifiedQuery(metric: Metric): string {
  switch (metric) {
    case "fastest":
      return `select count(*)::int as n from score where level_id = $1 and verified = true and time_ms < $2`;
    case "efficient":
      return `select count(*)::int as n from score where level_id = $1 and verified = true and boost_ms < $2`;
  }
}

function rankUnverifiedQuery(metric: Metric): string {
  switch (metric) {
    case "fastest":
      return `select count(*)::int as n from score where level_id = $1 and verified = false and time_ms < $2`;
    case "efficient":
      return `select count(*)::int as n from score where level_id = $1 and verified = false and boost_ms < $2`;
  }
}

/**
 * Rank a (levelId, metric, verified, value) tuple would receive on the leaderboard: 1-indexed,
 * verified-first. A verified row's rank is "how many verified rows beat it, plus one" — unverified
 * rows never factor in, because they can never outrank it regardless of their value. An unverified
 * row's rank is "every verified row (they all outrank it, unconditionally), plus how many unverified
 * rows beat it, plus one".
 */
export async function computeRank(
  sql: QueryFn,
  levelId: string,
  metric: Metric,
  verified: boolean,
  value: number,
): Promise<number> {
  if (verified) {
    const rows = await sql(rankVerifiedQuery(metric), [levelId, value]);
    return Number(rows[0]?.n ?? 0) + 1;
  }
  const [verifiedTotalRows, betterUnverifiedRows] = await Promise.all([
    sql(`select count(*)::int as n from score where level_id = $1 and verified = true`, [levelId]),
    sql(rankUnverifiedQuery(metric), [levelId, value]),
  ]);
  return Number(verifiedTotalRows[0]?.n ?? 0) + Number(betterUnverifiedRows[0]?.n ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// custom_level
// ---------------------------------------------------------------------------

/** No ambiguous glyphs (0/O, 1/I/L excluded) — matches tasks/T-12-LEDGER.md "Custom level ids":
 *  "Short, URL-safe, non-sequential slugs (8-10 chars from a base32 alphabet)." */
const SLUG_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const SLUG_LENGTH = 9;

/** `crypto.getRandomValues` is a Web Crypto API global in Node 22 — zero new dependency. Chosen
 *  over `Math.random` specifically because level ids double as unlisted-share-link tokens
 *  (DESIGN.md §9: "sharing is unlisted-by-default") — predictability here would let someone
 *  enumerate other players' shared levels, not just collide by bad luck. */
export function generateLevelSlug(): string {
  const bytes = new Uint8Array(SLUG_LENGTH);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < SLUG_LENGTH; i++) {
    out += SLUG_ALPHABET[(bytes[i] as number) % SLUG_ALPHABET.length];
  }
  return out;
}

const MAX_ID_ATTEMPTS = 5;

export class LevelIdExhaustedError extends Error {
  constructor() {
    super(`could not mint a unique level id after ${MAX_ID_ATTEMPTS} attempts`);
    this.name = "LevelIdExhaustedError";
  }
}

export interface CustomLevelInsert {
  name: string;
  author: string;
  /** Already validated via `@swingby/core`'s `validate()` by the caller — this function does not
   *  re-validate gameplay rules, only persists. */
  data: unknown;
}

/**
 * Inserts a new custom level under a freshly minted id, retrying on a genuine primary-key collision
 * (Postgres `23505 unique_violation`, surfaced by the Neon driver as `NeonDbError.code`). Relies on
 * the database's own constraint to detect a collision rather than a check-then-insert race
 * (select-then-insert would be racy under real concurrency; this is not). `idGenerator` is
 * injectable so a collision can be forced deterministically in a test instead of only reasoned
 * about probabilistically (32^9 ≈ 3.5e13 possible ids — a real collision here is not something a
 * test can wait for honestly).
 */
export async function insertCustomLevel(
  sql: QueryFn,
  row: CustomLevelInsert,
  idGenerator: () => string = generateLevelSlug,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
    const id = idGenerator();
    try {
      await sql(`insert into custom_level (id, name, author, data) values ($1, $2, $3, $4)`, [
        id,
        row.name,
        row.author,
        JSON.stringify(row.data),
      ]);
      return id;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err; // a real failure, not a collision — never retry this
      if (attempt === MAX_ID_ATTEMPTS - 1) throw new LevelIdExhaustedError();
      // else: genuine collision with attempts remaining — loop around and mint a fresh id.
    }
  }
  /* istanbul ignore next -- unreachable: every loop iteration either returns or throws above. */
  throw new LevelIdExhaustedError();
}

export interface CustomLevelRow {
  id: string;
  name: string;
  author: string;
  data: unknown;
  plays: number;
  createdAt: string;
}

export async function fetchCustomLevel(sql: QueryFn, id: string): Promise<CustomLevelRow | null> {
  const rows = await sql(
    `select id, name, author, data, plays, created_at from custom_level where id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    name: String(r.name),
    author: String(r.author),
    data: r.data,
    plays: Number(r.plays),
    createdAt: toIsoString(r.created_at),
  };
}

function listLevelsQuery(sort: LevelsSort): string {
  switch (sort) {
    case "new":
      return `select id, name, author, plays from custom_level order by created_at desc limit $1`;
    case "top":
      return `select id, name, author, plays from custom_level order by plays desc, created_at desc limit $1`;
  }
}

export interface LevelListEntry {
  id: string;
  name: string;
  author: string;
  plays: number;
}

export async function listCustomLevels(
  sql: QueryFn,
  sort: LevelsSort,
  limit: number,
): Promise<LevelListEntry[]> {
  const rows = await sql(listLevelsQuery(sort), [limit]);
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    author: String(r.author),
    plays: Number(r.plays),
  }));
}
