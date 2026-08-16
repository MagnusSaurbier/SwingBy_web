// T-13 PODIUM — response-shape guards. "Never trust the server's response shape" (task doc rule 9):
// every value that crosses the network boundary from `GET /api/leaderboard` or `GET /api/levels/:id`
// is untrusted remote data until it passes one of these. Nothing here throws; malformed input
// produces an empty/dropped result, never an exception that could break the caller.
//
// `name` fields are treated as plain text everywhere downstream (`ui/leaderboard/**` uses
// `textContent`/`createTextNode`, never `innerHTML`) — sanitizing here is defense in depth (control
// characters, absurd length), not the XSS boundary itself. See "Privacy" in tasks/T-13-PODIUM.md:
// "do not rely on [server-side stripping] alone."

import { validate } from "@swingby/core";
import type { Level } from "@swingby/core";
import type { LeaderboardEntry } from "./index.js";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// Strips control characters (C0 0x00-0x1F, DEL 0x7F, C1 0x80-0x9F), mirroring api/_validate.ts's
// CONTROL_CHARS — same character classes, independently applied here, since the server's own
// sanitization is not something a client is entitled to assume happened. Built from char codes
// (String.fromCharCode) rather than a literal escape sequence in source, deliberately, so this
// file's own text never contains a raw unescaped control byte.
const CONTROL_CODE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
];

function stripControlChars(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = CONTROL_CODE_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
    if (!isControl) out += ch;
  }
  return out;
}

/** Generous cap (well above the server's 24-char `MAX_NAME_LEN`) — wide enough that a legitimate,
 *  already-sanitized name is never touched, tight enough that a hostile or stale payload cannot
 *  hand the renderer an unbounded string. Falls back to "Anonymous" rather than dropping the whole
 *  row: a rank and a time are still meaningful leaderboard information even with a blank name. */
const MAX_DISPLAY_NAME_LEN = 64;

export function sanitizeDisplayName(raw: string): string {
  const cleaned = stripControlChars(raw).trim().slice(0, MAX_DISPLAY_NAME_LEN);
  return cleaned.length > 0 ? cleaned : "Anonymous";
}

/** Client-side mirror of `api/_validate.ts`'s `MAX_NAME_LEN` (24) — applied to the OUTGOING
 *  `submitScore` name so a submission never carries more bytes than the server will keep, and so a
 *  user typing a too-long username sees the name that will actually appear on the leaderboard
 *  reflected locally (e.g. in a future "preview" UI), not a silently-truncated surprise later. Not
 *  the security boundary (the server re-sanitizes independently) — just avoids sending dead weight. */
const OUTGOING_NAME_MAX_LEN = 24;

export function sanitizeOutgoingName(raw: string): string {
  return stripControlChars(raw).trim().slice(0, OUTGOING_NAME_MAX_LEN);
}

/**
 * One leaderboard row, validated field by field. Returns `null` for anything that doesn't shape up
 * — the caller drops the row rather than rendering partial/garbage data. Order of `entries` in the
 * response is preserved (never re-sorted here) — INTERFACES.md/tasks doc: "mirror the server's
 * ordering rather than re-sorting client-side."
 */
function parseOneEntry(raw: unknown): LeaderboardEntry | null {
  if (!isPlainObject(raw)) return null;
  const { rank, name, timeMs, boostMs, verified } = raw;
  if (!isPositiveInteger(rank)) return null;
  if (typeof name !== "string") return null;
  if (!isFiniteNonNegative(timeMs)) return null;
  if (!isFiniteNonNegative(boostMs)) return null;
  if (typeof verified !== "boolean") return null;
  return { rank, name: sanitizeDisplayName(name), timeMs, boostMs, verified };
}

/** `GET /api/leaderboard` response body -> validated entries. Any top-level shape mismatch (not an
 *  object, no `entries` array) yields `[]`, matching how `Api.leaderboard()` degrades on a network
 *  failure — a caller cannot tell "empty leaderboard" apart from "malformed response" apart from
 *  "offline", by design (task doc: "quiet offline note", not a special-cased error path per failure
 *  kind). */
export function parseLeaderboardEntries(raw: unknown): LeaderboardEntry[] {
  if (!isPlainObject(raw)) return [];
  const entries = raw.entries;
  if (!Array.isArray(entries)) return [];
  const out: LeaderboardEntry[] = [];
  for (const item of entries) {
    const entry = parseOneEntry(item);
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * `GET /api/levels/:id` response body -> a trustworthy `Level`, or `null`. Two layers: a shape
 * check (is `data` even object-shaped, do `name`/`author` exist as strings) followed by
 * `@swingby/core`'s own `validate()` for the full gameplay-rules layer (exactly one player, goal in
 * range, at least one gravitating body, etc.) — the same function the game itself trusts elsewhere,
 * so a level that passes this can never violate an invariant the simulation assumes. `validate()`
 * is defensive against every wrong-shape input by construction (checked directly,
 * packages/core/src/level.ts: non-array `objects`, non-object elements, wrong-typed fields all
 * produce error strings, never a thrown exception) — safe to hand it raw untrusted JSON.
 */
export function parseLevelResponse(raw: unknown): Level | null {
  if (!isPlainObject(raw)) return null;
  const data = raw.data;
  if (!isPlainObject(data)) return null;

  const name = typeof raw.name === "string" ? raw.name : typeof data.name === "string" ? data.name : null;
  const author =
    typeof raw.author === "string" ? raw.author : typeof data.author === "string" ? data.author : null;
  if (name === null || author === null) return null;

  const candidate = {
    name,
    author,
    goal: data.goal,
    objects: data.objects,
  } as Level;

  const result = validate(candidate);
  if (!result.ok) return null;
  return candidate;
}

/** `POST /api/score` response body -> the frozen `{ accepted, rank? }` shape. Anything else (wrong
 *  types, missing `accepted`) is treated as a non-acceptance rather than trusted at face value. */
export function parseScoreResponse(raw: unknown): { accepted: boolean; rank?: number } {
  if (!isPlainObject(raw)) return { accepted: false };
  const accepted = raw.accepted === true;
  const rank = raw.rank;
  if (accepted && typeof rank === "number" && Number.isInteger(rank) && rank >= 1) {
    return { accepted, rank };
  }
  return { accepted };
}

/** `POST /api/levels` response body -> `{ id }`, or `null` if the server didn't actually give us
 *  one back. `isValidLevelIdFormat`'s pattern in `api/_validate.ts` is `^[A-Za-z0-9_-]{1,40}$` —
 *  mirrored here (independently, not imported — `api/` is a different task's package) so a
 *  malformed id can never end up embedded in a share URL. */
const LEVEL_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export function parseShareResponse(raw: unknown): { id: string } | null {
  if (!isPlainObject(raw)) return null;
  const id = raw.id;
  if (typeof id !== "string" || !LEVEL_ID_PATTERN.test(id)) return null;
  return { id };
}
