/**
 * Replay encoding and server-side verification.
 *
 * This is the trust boundary: `verifyReplay` is the function a server runs to decide whether a
 * submitted score is real. The tape, the claim, and (indirectly, via whatever level id the caller
 * resolved) the level are all attacker-controlled inputs. This file must never hang (bounded tick
 * count, checked before any simulation work), never throw on garbage (every branch returns a
 * `VerifyResult` instead), and never accept a claim the replay does not actually produce (strict
 * equality by default — see `verifyReplay`).
 *
 * Zero dependencies, no browser/node APIs: only `+ - * / Math`, arrays, and strings. See
 * notes/archive/T-02-TAPE/log.md for the design rationale (tick/time semantics, rounding, encoding
 * format).
 */

import { hydrate, LevelError } from "./level.js";
import { simulateTick } from "./physics.js";
import { TPS } from "./constants.js";
import type { InputState, Level, ReplayTape, VerifyResult } from "./types.js";

// ---------------------------------------------------------------------------
// Rejection limits — docs/INTERFACES.md#corereplayts / notes/archive/T-02-TAPE/task.md
// "Rejection rules". Cheap guards, checked before any physics work, against resource exhaustion
// from a hostile tape.
// ---------------------------------------------------------------------------

/** `144 * 600` — ten minutes at 144 Hz. */
export const MAX_TAPE_TICKS = 144 * 600;

/** Combined `boost.length + brake.length` ceiling. A real 60s run is "tens", not thousands. */
export const MAX_TAPE_TRANSITIONS = 2000;

// ---------------------------------------------------------------------------
// TapeRecorder — fed by the game loop, one `record(tick, input)` call per simulated tick.
// ---------------------------------------------------------------------------

/** Records per-tick input into transition-index form (types.ts's `ReplayTape` semantics). */
export class TapeRecorder {
  private readonly boostTransitions: number[] = [];
  private readonly brakeTransitions: number[] = [];
  private boostHeld = false;
  private brakeHeld = false;

  /**
   * Call once per simulated tick, in non-decreasing tick order (the caller — T-05 FLYWHEEL — owns
   * the call site and the tick counter). Only appends a transition index when the control's held
   * state actually changes, which is what keeps the tape small.
   */
  record(tick: number, input: InputState): void {
    if (input.boost !== this.boostHeld) {
      this.boostTransitions.push(tick);
      this.boostHeld = input.boost;
    }
    if (input.brake !== this.brakeHeld) {
      this.brakeTransitions.push(tick);
      this.brakeHeld = input.brake;
    }
  }

  /** Finalizes the recording. `totalTicks` is the caller's own elapsed-tick count. */
  finish(totalTicks: number): ReplayTape {
    return {
      ticks: totalTicks,
      boost: [...this.boostTransitions],
      brake: [...this.brakeTransitions],
    };
  }
}

// ---------------------------------------------------------------------------
// inputAtTick — O(log n) binary search over a strictly-increasing transition array.
// ---------------------------------------------------------------------------

/**
 * Count of entries in a strictly-increasing `transitions` array that are `<= tick`, found by
 * binary search (upper-bound search) — O(log n), never a linear scan. Held state at `tick` is
 * `true` iff this count is odd (transitions start from "released" and each one flips the state —
 * see `ReplayTape`'s doc comment in types.ts).
 */
function transitionCountAtMost(
  transitions: readonly number[],
  tick: number,
): number {
  let lo = 0;
  let hi = transitions.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const v = transitions[mid];
    if (v !== undefined && v <= tick) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function heldAtTick(transitions: readonly number[], tick: number): boolean {
  return transitionCountAtMost(transitions, tick) % 2 === 1;
}

/** Reconstructs the input state at a given tick. O(log n) — binary search, not a linear scan. */
export function inputAtTick(tape: ReplayTape, tick: number): InputState {
  return {
    boost: heldAtTick(tape.boost, tick),
    brake: heldAtTick(tape.brake, tick),
    thrustX: 0,
    thrustY: 0,
  };
}

// ---------------------------------------------------------------------------
// verifyReplay — the trust boundary.
// ---------------------------------------------------------------------------

const MS_PER_TICK = 1000 / TPS;

/**
 * Ticks -> ms at the API boundary (docs/GAME.md §4: durations are integer ticks internally, ms only
 * at display/API boundaries). Rounded to the nearest integer millisecond — see
 * notes/archive/T-02-TAPE/log.md entry 2026-08-13T00:00Z point 2 for why, and the open question
 * this leaves for whatever code produces the client-side `claim.timeMs`/`claim.boostMs`.
 */
function ticksToMs(ticks: number): number {
  return Math.round(ticks * MS_PER_TICK);
}

/**
 * Validates tape shape WITHOUT simulating (notes/archive/T-02-TAPE/task.md "Rejection rules").
 * Returns an error string describing the first problem found, or `null` if the tape is well-formed
 * enough to simulate. Deliberately does not throw on any input shape — `tape` is typed
 * `ReplayTape` for the happy path, but every access below is guarded so that a hostile
 * `JSON.parse`d payload cast to `ReplayTape` by an untrusting caller is handled, not crashed on.
 */
function findMalformedReason(tape: ReplayTape): string | null {
  if (tape === null || typeof tape !== "object") {
    return "tape must be an object";
  }

  const ticksRaw: unknown = (tape as { ticks?: unknown }).ticks;
  if (
    typeof ticksRaw !== "number" ||
    !Number.isInteger(ticksRaw) ||
    ticksRaw < 0
  ) {
    return "ticks must be a non-negative integer";
  }
  if (ticksRaw > MAX_TAPE_TICKS) {
    return `ticks (${ticksRaw}) exceeds the ${MAX_TAPE_TICKS}-tick (10 minute) cap`;
  }
  const ticks = ticksRaw;

  const boostRaw: unknown = (tape as { boost?: unknown }).boost;
  const brakeRaw: unknown = (tape as { brake?: unknown }).brake;
  if (!Array.isArray(boostRaw)) return "boost must be an array";
  if (!Array.isArray(brakeRaw)) return "brake must be an array";

  const totalTransitions = boostRaw.length + brakeRaw.length;
  if (totalTransitions > MAX_TAPE_TRANSITIONS) {
    return `total transitions (${totalTransitions}) exceeds the ${MAX_TAPE_TRANSITIONS}-transition cap`;
  }

  return (
    findTransitionArrayError(boostRaw, ticks, "boost") ??
    findTransitionArrayError(brakeRaw, ticks, "brake")
  );
}

/** Every element finite-integer, in `[0, ticks)`, and the array strictly increasing. */
function findTransitionArrayError(
  arr: readonly unknown[],
  ticks: number,
  label: string,
): string | null {
  let prev = -1;
  for (let i = 0; i < arr.length; i++) {
    const v: unknown = arr[i];
    if (typeof v !== "number" || !Number.isInteger(v)) {
      return `${label}[${i}] must be an integer`;
    }
    if (v < 0 || v >= ticks) {
      return `${label}[${i}] (${v}) out of range [0, ${ticks})`;
    }
    if (v <= prev) {
      return `${label} transitions must be strictly increasing (index ${i})`;
    }
    prev = v;
  }
  return null;
}

function malformed(): VerifyResult {
  return { ok: false, reason: "malformed", timeMs: 0, boostMs: 0, ticks: 0 };
}

/** `Number.isFinite`-guarded comparison. NaN/Infinity claims never pass (NaN comparisons are
 *  always false in JS, so an unguarded `Math.abs(a - NaN) > tol` would silently accept forged
 *  claims — this is the one line in this file where getting the guard order backwards is a
 *  security bug, not just a correctness one). */
function withinTolerance(
  simulated: number,
  claimed: unknown,
  tolerance: number,
): boolean {
  if (typeof claimed !== "number" || !Number.isFinite(claimed)) return false;
  if (!Number.isFinite(tolerance)) return false;
  return Math.abs(simulated - claimed) <= tolerance;
}

/**
 * Replays `tape` against `level` and reports what actually happened, comparing it against the
 * client's `claim`. Pure, node-safe, never throws.
 *
 * Semantics (see notes/T-02-TAPE/log.md for the reasoning): the tape is simulated tick-by-tick from
 * 0; the FIRST tick at which the player enters `goalRange` of the goal body is the capture tick,
 * and `elapsedTicks = captureTick + 1` is what's compared against `claim.timeMs` — NOT `tape.ticks`
 * itself. This closes a forgery path where a tape is padded with idle ticks past the real capture
 * to sit under a slower advertised time. `boostMs` counts held-boost ticks from 0 through the
 * capture tick inclusive. If the player goes out of bounds before ever reaching the goal, that's an
 * immediate `"out-of-bounds"` failure; if the goal is never reached within `tape.ticks`, `"no-goal"`.
 */
export function verifyReplay(
  level: Level,
  tape: ReplayTape,
  claim: { timeMs: number; boostMs: number },
  tolerance?: { timeMs?: number; boostMs?: number },
): VerifyResult {
  try {
    const malformedReason = findMalformedReason(tape);
    if (malformedReason !== null) {
      return malformed();
    }

    let world;
    try {
      world = hydrate(level);
    } catch (err) {
      if (err instanceof LevelError) return malformed();
      throw err;
    }

    const timeTolMs = tolerance?.timeMs ?? 0;
    const boostTolMs = tolerance?.boostMs ?? 0;

    let firstBoostFired = false;
    let boostTicks = 0;
    let captureTick = -1;

    for (let tick = 0; tick < tape.ticks; tick++) {
      const input = inputAtTick(tape, tick);
      if (input.boost || input.brake) boostTicks++;

      const result = simulateTick(world, input, {
        allowInput: true,
        firstBoostFired,
      });
      if (result.firstBoostTriggered) firstBoostFired = true;

      if (result.reachedGoal) {
        captureTick = tick;
        break;
      }
      if (result.outOfBounds) {
        return {
          ok: false,
          reason: "out-of-bounds",
          timeMs: ticksToMs(tick + 1),
          boostMs: ticksToMs(boostTicks),
          ticks: tick + 1,
        };
      }
    }

    if (captureTick < 0) {
      return {
        ok: false,
        reason: "no-goal",
        timeMs: ticksToMs(tape.ticks),
        boostMs: ticksToMs(boostTicks),
        ticks: tape.ticks,
      };
    }

    const elapsedTicks = captureTick + 1;
    const timeMs = ticksToMs(elapsedTicks);
    const boostMs = ticksToMs(boostTicks);

    if (!withinTolerance(timeMs, claim?.timeMs, timeTolMs)) {
      return {
        ok: false,
        reason: "time-mismatch",
        timeMs,
        boostMs,
        ticks: elapsedTicks,
      };
    }
    if (!withinTolerance(boostMs, claim?.boostMs, boostTolMs)) {
      return {
        ok: false,
        reason: "boost-mismatch",
        timeMs,
        boostMs,
        ticks: elapsedTicks,
      };
    }

    return { ok: true, timeMs, boostMs, ticks: elapsedTicks };
  } catch {
    // Belt-and-braces: any unexpected exception anywhere above (a hostile `level`, an internal
    // physics edge case, whatever) degrades to a failed verification rather than propagating. This
    // function's contract is "never throw".
    return malformed();
  }
}

// ---------------------------------------------------------------------------
// encodeTape / decodeTape — URL-safe, compact, zero-dependency.
//
// Format: unsigned LEB128 varints, packed as:
//   varint(ticks)
//   varint(boost.length)  varint(delta_0) ... varint(delta_{n-1})
//   varint(brake.length)  varint(delta_0) ... varint(delta_{n-1})
// where delta_0 = value_0 (baseline 0) and delta_i = value_i - value_{i-1} for i > 0 (>= 1, since
// transition arrays are strictly increasing). The resulting byte string is base64url-encoded with a
// hand-rolled alphabet table (no `btoa`, no `Buffer` — both are host APIs, not ECMAScript
// builtins, and only one of the two exists in any given environment).
// ---------------------------------------------------------------------------

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function pushVarint(bytes: number[], value: number): void {
  let v = value;
  // Arithmetic (not bitwise shifts) throughout: bitwise ops in JS coerce to 32-bit signed, which
  // would silently corrupt values above ~2^31. Tick counts are capped well under that, but this
  // keeps the encoder correct for any non-negative integer, not just ones under the current cap.
  while (v >= 0x80) {
    bytes.push((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v);
}

/** Cap on continuation bytes read for a single varint. Real values here never need more than 5-6
 *  bytes (10 minutes of ticks is ~86400, well under 2^24); 10 gives headroom while still bounding
 *  a hostile/corrupted byte stream whose continuation bit is always set. */
const MAX_VARINT_BYTES = 10;

interface Cursor {
  pos: number;
}

function readVarint(bytes: Uint8Array, cursor: Cursor): number {
  let result = 0;
  let multiplier = 1;
  let bytesRead = 0;
  for (;;) {
    if (cursor.pos >= bytes.length) {
      throw new Error("decodeTape: truncated varint");
    }
    if (bytesRead >= MAX_VARINT_BYTES) {
      throw new Error("decodeTape: varint exceeds maximum length");
    }
    const byte = bytes[cursor.pos];
    if (byte === undefined) throw new Error("decodeTape: truncated varint");
    cursor.pos++;
    bytesRead++;
    result += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) break;
    multiplier *= 128;
  }
  return result;
}

function bytesToBase64Url(bytes: readonly number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;

    const triple = (b0 << 16) | (b1 << 8) | b2;

    out += BASE64URL_ALPHABET[(triple >> 18) & 0x3f];
    out += BASE64URL_ALPHABET[(triple >> 12) & 0x3f];
    out += hasB1 ? BASE64URL_ALPHABET[(triple >> 6) & 0x3f] : "";
    out += hasB2 ? BASE64URL_ALPHABET[triple & 0x3f] : "";
  }
  return out;
}

// `Object.create(null)` rather than `{}` — no prototype chain, so a lookup can never resolve to
// an inherited `Object.prototype` member (`toString`, `constructor`, ...) even in principle. Not
// strictly reachable given every lookup key below is a single UTF-16 code unit sliced from the
// input string, but the guard is free and removes the question entirely.
const BASE64URL_DECODE_MAP: Record<string, number> = Object.create(
  null,
) as Record<string, number>;
for (let i = 0; i < BASE64URL_ALPHABET.length; i++) {
  const ch = BASE64URL_ALPHABET[i];
  if (ch !== undefined) BASE64URL_DECODE_MAP[ch] = i;
}

function base64UrlToBytes(encoded: string): Uint8Array {
  // Unpadded base64url: every 4 input chars -> 3 bytes; a final group of 2 or 3 chars -> 1 or 2
  // bytes respectively. A final group of exactly 1 char is impossible to have been produced by the
  // encoder and cannot decode to a whole byte — reject it rather than silently truncating.
  const len = encoded.length;
  const remainder = len % 4;
  if (remainder === 1) {
    throw new Error("decodeTape: invalid base64url length");
  }

  const fullGroups = Math.floor(len / 4);
  const outLen = fullGroups * 3 + (remainder === 0 ? 0 : remainder - 1);
  const out = new Uint8Array(outLen);
  let outPos = 0;

  for (let i = 0; i < len; i += 4) {
    const c0 = encoded[i];
    const c1 = encoded[i + 1];
    const c2 = encoded[i + 2];
    const c3 = encoded[i + 3];

    const v0 = c0 !== undefined ? BASE64URL_DECODE_MAP[c0] : undefined;
    const v1 = c1 !== undefined ? BASE64URL_DECODE_MAP[c1] : undefined;
    if (v0 === undefined || (c1 !== undefined && v1 === undefined)) {
      throw new Error("decodeTape: invalid base64url character");
    }
    if (v1 === undefined) break; // only c0 present with no c1: covered by remainder===1 guard above

    const v2 = c2 !== undefined ? BASE64URL_DECODE_MAP[c2] : undefined;
    const v3 = c3 !== undefined ? BASE64URL_DECODE_MAP[c3] : undefined;
    if (c2 !== undefined && v2 === undefined)
      throw new Error("decodeTape: invalid base64url character");
    if (c3 !== undefined && v3 === undefined)
      throw new Error("decodeTape: invalid base64url character");

    const triple = (v0 << 18) | (v1 << 12) | ((v2 ?? 0) << 6) | (v3 ?? 0);

    out[outPos++] = (triple >> 16) & 0xff;
    if (c2 !== undefined) out[outPos++] = (triple >> 8) & 0xff;
    if (c3 !== undefined) out[outPos++] = triple & 0xff;
  }

  return out;
}

/** URL-safe, compact encoding of a `ReplayTape`. Round-trips exactly through `decodeTape`. */
export function encodeTape(tape: ReplayTape): string {
  const bytes: number[] = [];
  pushVarint(bytes, tape.ticks);

  pushVarint(bytes, tape.boost.length);
  let prevBoost = 0;
  for (const v of tape.boost) {
    pushVarint(bytes, v - prevBoost);
    prevBoost = v;
  }

  pushVarint(bytes, tape.brake.length);
  let prevBrake = 0;
  for (const v of tape.brake) {
    pushVarint(bytes, v - prevBrake);
    prevBrake = v;
  }

  return bytesToBase64Url(bytes);
}

/**
 * Decodes a string produced by `encodeTape`. Throws a descriptive `Error` (never hangs, never
 * silently produces garbage) on truncated input, invalid characters, or a corrupted varint stream
 * — callers that receive an encoded tape from the network should wrap this in their own try/catch
 * and treat a decode failure the same as any other malformed submission.
 */
export function decodeTape(encoded: string): ReplayTape {
  if (typeof encoded !== "string") {
    throw new Error("decodeTape: input must be a string");
  }
  if (encoded.length === 0) {
    return { ticks: 0, boost: [], brake: [] };
  }

  const bytes = base64UrlToBytes(encoded);
  const cursor: Cursor = { pos: 0 };

  const ticks = readVarint(bytes, cursor);

  const boostLen = readVarint(bytes, cursor);
  const boost: number[] = [];
  let runningBoost = 0;
  for (let i = 0; i < boostLen; i++) {
    runningBoost += readVarint(bytes, cursor);
    boost.push(runningBoost);
  }

  const brakeLen = readVarint(bytes, cursor);
  const brake: number[] = [];
  let runningBrake = 0;
  for (let i = 0; i < brakeLen; i++) {
    runningBrake += readVarint(bytes, cursor);
    brake.push(runningBrake);
  }

  return { ticks, boost, brake };
}
