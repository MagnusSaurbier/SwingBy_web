// Shared HTTP mechanics for net/**. Not one of docs/INTERFACES.md's two named files (`index.ts`,
// `queue.ts`), but squarely inside `packages/web/src/net/**`.
//
// Why this exists as a separate module: `Api.submitScore`'s return type
// (`{ accepted: boolean; rank?: number }`, docs/INTERFACES.md) cannot carry enough signal to make
// a good retry/backoff decision — "rate limited, try again in 40s" and "network is just down" and
// "the server permanently rejected this" all have to collapse to `accepted: false` at that
// boundary. `queue.ts` needs the richer signal to back off correctly; `index.ts`'s `createApi`
// needs the narrow shape. Both share this one HTTP core so the retry-worthy-vs-not distinction is
// decided in exactly one place, not duplicated.
//
// Every path returns a value — this module never throws and never lets a rejected promise reach
// its caller. See notes/archive/T-13-PODIUM/log.md "Design, file by file" for the reasoning.

/** 3-5s is the target range for this timeout. Sized against the server-side scoring route's own
 *  measured numbers (notes/archive/T-12-LEDGER/log.md): verifyReplay-through-the-real-route runs
 *  11-24ms typical, up to
 *  ~160ms at the 600s tape cap. 4000ms leaves ~3.84s of margin over that worst case for real
 *  network RTT + TLS handshake, while still failing fast enough that a hung request never reads
 *  as "the game is broken" to a player who has already seen their completion panel. */
export const REQUEST_TIMEOUT_MS = 4000;

export type HttpOutcome<T> =
  | { kind: "ok"; status: number; value: T }
  | { kind: "http-error"; status: number; body: unknown }
  | { kind: "rate-limited"; retryAfterMs: number }
  | { kind: "timeout" }
  | { kind: "network-error" }
  | { kind: "invalid-json" };

/** Whether an outcome is worth retrying later, vs. a permanent failure the caller should not
 *  resubmit unchanged. `http-error` in the 4xx range (other than 429, handled separately) is
 *  treated as permanent — the payload itself is what the server rejected, and resending the exact
 *  same bytes will not change that. 5xx and every network-shaped failure are transient. */
export function isRetryable(outcome: HttpOutcome<unknown>): boolean {
  switch (outcome.kind) {
    case "ok":
      return false;
    case "rate-limited":
    case "timeout":
    case "network-error":
    case "invalid-json":
      return true;
    case "http-error":
      return outcome.status >= 500;
  }
}

/** Parses a `Retry-After` header (seconds, per HTTP spec and what `api/score.ts`/`api/levels/
 *  index.ts` actually send via `Math.ceil(retryAfterMs/1000)`) into milliseconds. Falls back to
 *  `fallbackMs` for a missing or unparseable header — a hostile or buggy server's header must never
 *  crash the caller or produce a NaN/negative delay. */
function parseRetryAfterMs(
  headerValue: string | null,
  fallbackMs: number,
): number {
  if (headerValue === null) return fallbackMs;
  const seconds = Number(headerValue);
  if (!Number.isFinite(seconds) || seconds < 0) return fallbackMs;
  return Math.round(seconds * 1000);
}

/** Default backoff when a 429 arrives without a (or with a malformed) `Retry-After` header —
 *  matches T-12's own configured window (`SCORE_RATE_LIMIT.windowMs` / `LEVEL_RATE_LIMIT.windowMs`,
 *  both 60_000ms, see api/_ratelimit.ts) so a missing header still waits out a full window rather
 *  than hammering again immediately. */
export const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60_000;

/**
 * Fetches `url`, aborting after `timeoutMs`. Never throws — every failure mode (network refusal,
 * DNS failure, timeout, non-JSON body, non-2xx status, a 429) is a distinct `HttpOutcome` variant
 * so callers can make an informed retry decision without their own try/catch.
 */
export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<HttpOutcome<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { kind: "timeout" };
    }
    return { kind: "network-error" };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    const retryAfterMs = parseRetryAfterMs(
      res.headers.get("Retry-After"),
      DEFAULT_RATE_LIMIT_BACKOFF_MS,
    );
    // Drain the body even though we don't use it — an unconsumed body can keep the underlying
    // connection from being reused by some runtimes; cheap and harmless either way.
    await res.text().catch(() => undefined);
    return { kind: "rate-limited", retryAfterMs };
  }

  let parsed: unknown;
  try {
    const text = await res.text();
    parsed = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    return { kind: "invalid-json" };
  }

  if (!res.ok) {
    return { kind: "http-error", status: res.status, body: parsed };
  }

  return { kind: "ok", status: res.status, value: parsed as T };
}
