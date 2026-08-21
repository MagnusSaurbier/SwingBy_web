/**
 * GET /api/levels/:id (docs/INTERFACES.md#api).
 *
 *   GET /api/levels/:id -> { id, name, author, data }
 *
 * Vercel's file-system routing maps the `[id]` segment of this filename to `req.query.id`.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

import {
  DbConfigError,
  fetchCustomLevel,
  getSql,
  type QueryFn,
} from "../_db.js";
import { isValidLevelIdFormat } from "../_validate.js";

export interface LevelGetResponseBody {
  id: string;
  name: string;
  author: string;
  data: unknown;
}

/** Core logic, independent of the HTTP transport. */
export async function handleLevelGet(
  idRaw: unknown,
  sql: QueryFn,
): Promise<{ status: number; body: LevelGetResponseBody | { error: string } }> {
  if (!isValidLevelIdFormat(idRaw)) {
    return { status: 400, body: { error: "invalid-level-id" } };
  }

  const row = await fetchCustomLevel(sql, idRaw);
  if (!row) {
    return { status: 404, body: { error: "level-not-found" } };
  }

  return {
    status: 200,
    body: { id: row.id, name: row.name, author: row.author, data: row.data },
  };
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

  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const { status, body } = await handleLevelGet(id, sql);
  res.status(status).json(body);
}
