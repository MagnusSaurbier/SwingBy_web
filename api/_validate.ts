/**
 * T-12 LEDGER — shared input validation and hostile-payload bounding.
 *
 * Every route is a public, unauthenticated write (or read) surface on the open internet. Nothing
 * here trusts shape, size, or type of anything that came off the wire — see "Security posture" in
 * the task briefing and tasks/T-12-LEDGER.md "Abuse surface". Functions here return rather than
 * throw wherever the caller is expected to turn a bad input into a 400, matching the same
 * never-throw-on-garbage discipline `@swingby/core`'s `validate()` and `verifyReplay()` use.
 */

/**
 * The minimal shape `readJsonBody` actually needs — real `IncomingMessage` (what every Vercel
 * route handler passes in production) satisfies this structurally with room to spare, but keeping
 * the parameter this narrow means a test can supply a plain fake without pretending to implement
 * dozens of unrelated `IncomingMessage` members it will never touch.
 */
export interface JsonBodySource extends AsyncIterable<Buffer | string> {
  headers: { "content-length"?: string | string[] };
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Size / length caps — chosen with headroom over real data, tight against abuse.
// See notes/T-12-LEDGER/log.md for the reasoning on each.
// ---------------------------------------------------------------------------

/** Raw request body ceiling for POST /api/score. A real tape is "tens to hundreds of bytes"
 *  (packages/core/src/replay.ts caps at 2000 transitions / 10 minutes of ticks); the task doc's own
 *  number for the encoded tape is 64 KB, generous already. The rest of the body (name, ids, two
 *  numbers) is trivial by comparison, so 96 KB gives headroom without opening the door wide. */
export const MAX_SCORE_BODY_BYTES = 96 * 1024;

/** Raw request body ceiling for POST /api/levels. The 33 built-in levels are 200-550 bytes of JSON
 *  each; a hand-authored custom level with generous headroom (dozens of bodies) still fits easily
 *  under this. Also the first, cheapest line of defense against the "10 MB level payload" hostile
 *  case named in the task briefing — rejected before a single byte is JSON.parsed. */
export const MAX_LEVEL_BODY_BYTES = 32 * 1024;

export const MAX_NAME_LEN = 24;
export const MAX_LEVEL_NAME_LEN = 48;
export const MAX_LEVEL_AUTHOR_LEN = 32;

/** Generous over the built-in max (6) so real creativity isn't cramped, but far under a shape that
 *  would make `verifyReplay`'s per-tick gravity loop (O(bodies) per substep) expensive against a
 *  10-minute tape. See tasks/T-12-LEDGER.md "Abuse surface": "an adversarial level with 10,000
 *  bodies makes verification quadratic". */
export const MAX_LEVEL_OBJECTS = 64;

export const DEFAULT_LEADERBOARD_LIMIT = 50;
export const MAX_LEADERBOARD_LIMIT = 100;
export const DEFAULT_LEVELS_LIMIT = 20;
export const MAX_LEVELS_LIMIT = 100;

// ---------------------------------------------------------------------------
// readJsonBody — bounds the RAW BYTE STREAM before JSON.parse ever runs.
//
// Vercel's platform-level body parser (the default for a Node serverless function) would already
// have consumed and parsed the request by the time a handler sees `req.body`, at a default ceiling
// (~4.5 MB) far above anything this API should accept. Every POST route here opts out via
// `export const config = { api: { bodyParser: false } }` and calls this instead, so the size check
// happens on bytes actually received, not on the size of whatever object JSON.parse happened to
// produce. `Content-Length` is checked first for a zero-read rejection when the client is honest
// about size; the stream is also actively aborted mid-read if real bytes exceed the cap even when
// `Content-Length` is absent, zero, or lying (a hostile client is not required to send an accurate
// header) — this is what makes the bound real rather than advisory.
// ---------------------------------------------------------------------------

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; error: "too-large" | "invalid-json" | "read-error" };

export async function readJsonBody(
  req: JsonBodySource,
  maxBytes: number,
): Promise<JsonBodyResult> {
  const declaredLength = req.headers["content-length"];
  if (declaredLength !== undefined) {
    const declared = Number(declaredLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      // Drain/destroy without buffering — we already know this request is oversized.
      req.destroy();
      return { ok: false, error: "too-large" };
    }
  }

  const chunks: Buffer[] = [];
  let total = 0;

  try {
    for await (const chunk of req) {
      const buf: Buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as string);
      total += buf.length;
      if (total > maxBytes) {
        req.destroy();
        return { ok: false, error: "too-large" };
      }
      chunks.push(buf);
    }
  } catch {
    return { ok: false, error: "read-error" };
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) {
    return { ok: false, error: "invalid-json" };
  }

  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, error: "invalid-json" };
  }
}

// ---------------------------------------------------------------------------
// Primitive guards
// ---------------------------------------------------------------------------

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Finite, and within an inclusive range. Rejects NaN/Infinity implicitly via `isFiniteNumber`. */
export function isFiniteNumberInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return isFiniteNumber(value) && value >= min && value <= max;
}

// ---------------------------------------------------------------------------
// name sanitization — rendered on the leaderboard by T-13, so this is an output-safety boundary
// as much as an input one. Strips control characters (including the DEL 0x7F and the C1 range),
// collapses surrounding whitespace, caps length. Returns null for anything that isn't a usable
// display name after cleaning (not a string, empty, or all-whitespace/control).
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex -- deliberately matching control characters to strip them
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

export function sanitizeName(
  raw: unknown,
  maxLen: number = MAX_NAME_LEN,
): string | null {
  if (typeof raw !== "string") return null;
  const stripped = raw.replace(CONTROL_CHARS, "").trim();
  if (stripped.length === 0) return null;
  return stripped.slice(0, maxLen);
}

// ---------------------------------------------------------------------------
// Allowlisted enums — never interpolate the raw string into SQL; always map through one of these
// and use the literal branch, so an attacker-controlled "sort"/"metric" string can only ever select
// among a fixed, hand-written set of query strings, never influence SQL text directly.
// ---------------------------------------------------------------------------

export type Metric = "fastest" | "efficient";

export function parseMetric(raw: unknown): Metric | null {
  return raw === "fastest" || raw === "efficient" ? raw : null;
}

export type LevelsSort = "new" | "top";

export function parseSort(raw: unknown): LevelsSort | null {
  return raw === "new" || raw === "top" ? raw : null;
}

/** Clamps to `[1, max]`, falling back to `def` for anything not a positive-integer-shaped input
 *  (including query-string values, which arrive as strings). Never throws, never NaN-propagates. */
export function parseLimit(raw: unknown, def: number, max: number): number {
  const asString = Array.isArray(raw) ? raw[0] : raw;
  const n = typeof asString === "string" ? Number(asString) : asString;
  if (
    typeof n !== "number" ||
    !Number.isFinite(n) ||
    !Number.isInteger(n) ||
    n < 1
  ) {
    return def;
  }
  return Math.min(n, max);
}

// ---------------------------------------------------------------------------
// Level id shape guard — used for the `level` query param and the `levelId` submitted with a
// score. Deliberately permissive about which *format* it accepts (builtin `builtin-NN` or a
// T-12-minted custom slug) but strict about *character set*: only characters that can never be a
// SQL metacharacter or path-traversal sequence are allowed through at all. This is defense in
// depth, not the injection defense itself (every query is parameterized regardless) — it lets a
// junk `level=';DROP TABLE score;--` query fail fast with a clean 400 instead of reaching the
// database as a bind parameter that simply matches zero rows.
// ---------------------------------------------------------------------------

const LEVEL_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export function isValidLevelIdFormat(raw: unknown): raw is string {
  return typeof raw === "string" && LEVEL_ID_PATTERN.test(raw);
}

// ---------------------------------------------------------------------------
// Custom level payload guards (POST /api/levels). Cheap, pre-`validate()` shape checks — the real
// gameplay-rules validation is `@swingby/core`'s `validate()`, run afterwards in api/levels/index.ts.
// These exist to bound the DoS surface (object count) before that runs at all.
// ---------------------------------------------------------------------------

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True if `objects` is an array within the object-count cap. Does not check element shape —
 *  `@swingby/core`'s `validate()` owns every per-object rule. */
export function isBoundedObjectsArray(raw: unknown): raw is unknown[] {
  return Array.isArray(raw) && raw.length <= MAX_LEVEL_OBJECTS;
}
