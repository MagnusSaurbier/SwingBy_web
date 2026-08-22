/**
 * GET/POST /api/levels (docs/INTERFACES.md#api).
 *
 *   GET  /api/levels?sort=new|top&limit=20  -> { levels: [{ id, name, author, plays }] }
 *   POST /api/levels  { name, author, data } -> { id }
 *
 * **`data` field resolution**: docs/INTERFACES.md specifies this route's shape but not how the
 * top-level `name`/`author` relate to whatever `Level.name`/`Level.author` might also be embedded
 * inside `data` — `Level` itself carries both. Decision (see notes/archive/T-12-LEDGER/log.md,
 * decision 5): the top-level `name`/`author` are canonical — sanitized, length-capped, and the ONLY
 * source used for both `custom_level`'s own `name`/`author` columns and the `name`/`author` written
 * into the stored `data`. Anything a client embeds at `data.name` / `data.author` is discarded
 * before storage; `data.goal` / `data.objects` are what's kept and run through `@swingby/core`'s
 * `validate()` before anything is written — never trust `data`.
 */

import { validate } from "@swingby/core";
import type { Level } from "@swingby/core";
import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  DbConfigError,
  getSql,
  insertCustomLevel,
  listCustomLevels,
  type LevelListEntry,
  type QueryFn,
} from "../_db.js";
import {
  isBoundedObjectsArray,
  isPlainObject,
  parseLimit,
  parseSort,
  readJsonBody,
  sanitizeName,
  DEFAULT_LEVELS_LIMIT,
  MAX_LEVEL_AUTHOR_LEN,
  MAX_LEVEL_BODY_BYTES,
  MAX_LEVEL_NAME_LEN,
  MAX_LEVELS_LIMIT,
} from "../_validate.js";
import { getClientIp, levelRateLimiter } from "../_ratelimit.js";

export const config = { api: { bodyParser: false } };

export interface LevelsListResponseBody {
  levels: LevelListEntry[];
}

export interface LevelsCreateResponseBody {
  id: string;
}

type QueryValue = string | string[] | undefined;

function first(value: QueryValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function handleLevelsList(
  query: Record<string, QueryValue>,
  sql: QueryFn,
): Promise<{
  status: number;
  body: LevelsListResponseBody | { error: string };
}> {
  const sort = parseSort(first(query.sort)) ?? "new";
  const limit = parseLimit(
    first(query.limit),
    DEFAULT_LEVELS_LIMIT,
    MAX_LEVELS_LIMIT,
  );
  const levels = await listCustomLevels(sql, sort, limit);
  return { status: 200, body: { levels } };
}

/**
 * Reconstructs and validates the `Level` to store. Returns an error string (never throws) for
 * anything untrustworthy — oversized, wrong-shaped, or failing `@swingby/core`'s gameplay rules.
 */
function buildLevelToStore(
  rawBody: unknown,
): { level: Level; name: string; author: string } | { error: string } {
  if (!isPlainObject(rawBody)) return { error: "malformed-body" };

  const name = sanitizeName(rawBody.name, MAX_LEVEL_NAME_LEN);
  if (name === null) return { error: "invalid-name" };

  const author = sanitizeName(rawBody.author, MAX_LEVEL_AUTHOR_LEN);
  if (author === null) return { error: "invalid-author" };

  const data = rawBody.data;
  if (!isPlainObject(data)) return { error: "invalid-data" };

  // Cheap, cardinality-only bound BEFORE the full validate() pass — this is the guard against the
  // "adversarial level with 10,000 bodies" DoS shape (notes/archive/T-12-LEDGER/task.md "Abuse surface").
  if (!isBoundedObjectsArray(data.objects))
    return { error: "too-many-objects" };

  const level: Level = {
    name,
    author,
    goal: data.goal as Level["goal"],
    objects: data.objects as Level["objects"],
  };

  // requireGoal: true — sharing is the one place a target must actually be set (task: "Enforce the
  // target rule only on level share"). Preview/hydrate elsewhere accepts a level with no target.
  const result = validate(level, { requireGoal: true });
  if (!result.ok)
    return { error: `invalid-level: ${result.errors.join("; ")}` };

  return { level, name, author };
}

export async function handleLevelsCreate(
  rawBody: unknown,
  sql: QueryFn,
): Promise<{
  status: number;
  body: LevelsCreateResponseBody | { error: string };
}> {
  const built = buildLevelToStore(rawBody);
  if ("error" in built) {
    return { status: 400, body: { error: built.error } };
  }

  const id = await insertCustomLevel(sql, {
    name: built.name,
    author: built.author,
    data: built.level,
  });

  return { status: 200, body: { id } };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  let sql: QueryFn;
  try {
    sql = getSql();
  } catch (err) {
    const error =
      err instanceof DbConfigError ? err.message : "database-unavailable";
    res.status(500).json({ error });
    return;
  }

  if (req.method === "GET") {
    const { status, body } = await handleLevelsList(req.query, sql);
    res.status(status).json(body);
    return;
  }

  if (req.method === "POST") {
    const ip = getClientIp(req);
    const limit = levelRateLimiter.check(ip);
    if (!limit.allowed) {
      res.setHeader(
        "Retry-After",
        Math.ceil(limit.retryAfterMs / 1000).toString(),
      );
      res.status(429).json({ error: "rate-limited" });
      return;
    }

    const parsedBody = await readJsonBody(req, MAX_LEVEL_BODY_BYTES);
    if (!parsedBody.ok) {
      res.status(400).json({ error: parsedBody.error });
      return;
    }

    const { status, body } = await handleLevelsCreate(parsedBody.value, sql);
    res.status(status).json(body);
    return;
  }

  res.status(405).json({ error: "method-not-allowed" });
}
