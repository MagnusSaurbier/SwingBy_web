/**
 * T-12 LEDGER — rate limiting for the public write endpoints (POST /api/score, POST /api/levels).
 *
 * **Honest limitation, stated up front** (see notes/T-12-LEDGER/log.md and results/T-12-LEDGER.md
 * for the full writeup): this is an in-memory sliding-window counter, scoped to a single warm
 * serverless instance's process memory. There is no Redis/Vercel KV/other shared store available in
 * this environment (`api/package.json` is T-14's file — a new dependency there is a request, not
 * something this task can add unilaterally). Two consequences:
 *
 *   1. A cold start resets the counter to zero for that instance. Fine — it also means an attacker
 *      gains nothing by waiting for a cold start; they'd have to *cause* one, which costs more than
 *      the requests they'd save.
 *   2. Vercel may run several instances of the same function concurrently under load. Each gets its
 *      own independent counter, so the *effective* ceiling for a genuinely distributed source (many
 *      source IPs, or enough concurrent requests to spin up multiple warm instances) is the
 *      configured limit multiplied by however many instances are concurrently warm — not a hard cap.
 *      This is exactly the "what's its failure mode under a distributed source" the task asks to be
 *      stated plainly, not hidden behind an adjective.
 *
 * What this DOES stop, correctly: a single script hammering the endpoint from one source within one
 * warm instance's lifetime — which is the realistic "someone left a loop running" abuse case for a
 * personal-site leaderboard, not a botnet. A DB- or KV-backed limiter would close the distributed
 * gap; named as a follow-up in results.md, not implemented here.
 */

/** The minimal shape `getClientIp` needs — real `IncomingMessage`/`VercelRequest` satisfies this
 *  structurally with room to spare; kept narrow so tests can pass plain literal objects. */
export interface ClientIpSource {
  // Index signature, not a single named optional property: `x-forwarded-for` is not one of
  // Node's individually-typed `IncomingHttpHeaders` fields (only "well-known" headers like
  // content-length get that treatment — see @types/node/http.d.ts), it only exists via
  // `IncomingHttpHeaders`'s inherited `NodeJS.Dict<string | string[]>` index signature. A target
  // type whose only property is optional AND unrelated to any *named* source property trips
  // TypeScript's "weak type" check ("has no properties in common") when passing a real
  // `VercelRequest`/`IncomingMessage` — matching the index signature shape sidesteps that.
  headers: { [header: string]: string | string[] | undefined };
  socket?: { remoteAddress?: string };
}

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the caller may retry, 0 when `allowed`. */
  retryAfterMs: number;
  remaining: number;
}

export interface RateLimiterOptions {
  /** Max requests allowed inside `windowMs`. */
  limit: number;
  windowMs: number;
  /** Caps the number of distinct keys (IPs) tracked at once, evicting the oldest, so a low-rate
   *  scan across many distinct source addresses cannot grow this map without bound. Default 10_000
   *  is generous for a hobby leaderboard's realistic traffic. */
  maxTrackedKeys?: number;
}

export interface RateLimiter {
  check(key: string, now?: number): RateLimitResult;
  /** Test-only: clears all tracked state. */
  reset(): void;
  /** Test-only: number of distinct keys currently tracked. */
  size(): number;
}

/** Sliding-window counter, one timestamp array per key. `now` is an injectable parameter
 *  specifically so tests can drive the clock deterministically instead of sleeping in real time. */
export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const maxTrackedKeys = opts.maxTrackedKeys ?? 10_000;
  const hits = new Map<string, number[]>();

  return {
    check(key: string, now: number = Date.now()): RateLimitResult {
      const existing = hits.get(key) ?? [];
      const recent = existing.filter((t) => now - t < opts.windowMs);

      if (recent.length >= opts.limit) {
        hits.set(key, recent);
        const oldest = recent[0] ?? now;
        return {
          allowed: false,
          retryAfterMs: Math.max(0, opts.windowMs - (now - oldest)),
          remaining: 0,
        };
      }

      recent.push(now);
      if (!hits.has(key) && hits.size >= maxTrackedKeys) {
        // Map iteration order is insertion order — evict the oldest-inserted key.
        const oldestKey = hits.keys().next().value;
        if (oldestKey !== undefined) hits.delete(oldestKey);
      }
      hits.set(key, recent);

      return {
        allowed: true,
        retryAfterMs: 0,
        remaining: opts.limit - recent.length,
      };
    },
    reset(): void {
      hits.clear();
    },
    size(): number {
      return hits.size;
    },
  };
}

// ---------------------------------------------------------------------------
// Configured instances. "A few submissions per minute is generous for a human" (task doc) — 8/60s
// for scores, a bit tighter (5/60s) for level creation since it does more work (validation, jsonb
// write) per request.
// ---------------------------------------------------------------------------

export const SCORE_RATE_LIMIT = { limit: 8, windowMs: 60_000 };
export const LEVEL_RATE_LIMIT = { limit: 5, windowMs: 60_000 };

export const scoreRateLimiter: RateLimiter =
  createRateLimiter(SCORE_RATE_LIMIT);
export const levelRateLimiter: RateLimiter =
  createRateLimiter(LEVEL_RATE_LIMIT);

// ---------------------------------------------------------------------------
// Client IP extraction. Vercel sets `x-forwarded-for`; the first entry is the original client.
// Falls back to the raw socket address (meaningful mainly for local/dev testing, since a direct
// socket connection has no forwarding chain). Never throws.
// ---------------------------------------------------------------------------

export function getClientIp(req: ClientIpSource): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof first === "string" && first.length > 0) {
    const ip = first.split(",")[0]?.trim();
    if (ip) return ip;
  }
  return req.socket?.remoteAddress ?? "unknown";
}
