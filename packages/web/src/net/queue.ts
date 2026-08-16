// T-13 PODIUM — deliverable 2: the offline submission queue. This is what makes rule 5 in the
// task briefing true: "the game stays fully playable with the API unreachable... a player on a
// train with no signal must be able to finish a level, see their time, and have the score
// submitted later." `submit()` never blocks and never throws — it persists synchronously (so a
// crash a millisecond later doesn't lose the row) and returns immediately; the network attempt
// happens fully asynchronously afterward.
//
// Idempotency (task doc DoD: "No duplicate submissions on retry"). See notes/T-13-PODIUM/log.md
// finding 1 for the full reasoning — short version: the frozen `POST /api/score` wire contract
// (INTERFACES.md, `api/score.ts`) has no idempotency key field and `infra/schema.sql`'s `score`
// table has no unique constraint, so true server-side dedup is not something this task's frozen
// dependency supports. What IS implemented and proven (see results/T-13-PODIUM.md "Idempotency"):
// drains are single-flight (a module-level guard — two overlapping triggers can never both be
// mid-flight for the same item) and an item is removed from the persisted queue SYNCHRONOUSLY on
// any terminal outcome, so replaying `drain()` after a successful drain finds nothing to resend
// and issues zero further requests. The one honest gap: if a response is lost in flight after the
// server already committed the row, a retry will create a second one — inherent to the frozen
// contract having no client-supplied submission id, flagged as an open item, not hidden.
//
// Bounded growth: MAX_QUEUE_SIZE (drop-oldest on overflow), MAX_ATTEMPTS + MAX_AGE_MS (drop a
// stuck item rather than retry forever) — a permanently unreachable API cannot grow this without
// limit, and a submission from months ago (tape almost certainly re-verifiable but pointless to
// keep chasing) eventually gets pruned rather than resent indefinitely.

import type { SubmitScoreRequest } from "./index.js";
import { postScore } from "./index.js";
import { isRetryable, type HttpOutcome } from "./http.js";
import { parseScoreResponse } from "./validate.js";
import { chooseBackingStore, readJson, writeJson, type BackingStore } from "./persist.js";

export const QUEUE_STORAGE_KEY = "swingby:score_queue";
const SCHEMA_VERSION = 1;

/** Caps how many queued submissions can accumulate while genuinely offline. Generous for a
 *  personal-site leaderboard's realistic usage (a player would need to complete 20 unsynced
 *  personal bests before the oldest starts getting dropped) while still being an actual bound —
 *  "must not grow without bound" (task doc). */
export const MAX_QUEUE_SIZE = 20;

/** After this many failed attempts, drop the item rather than retry it forever. Combined with
 *  MAX_AGE_MS below, whichever bound is hit first prunes the item. */
export const MAX_ATTEMPTS = 8;

/** Prune anything older than this regardless of attempt count — an unsynced score from a week ago
 *  is not worth an indefinitely-growing queue over. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Exponential-ish backoff schedule in milliseconds, indexed by attempt number (clamped to the
 *  last entry). Sized against T-12 LEDGER's real sliding window (60_000ms, `SCORE_RATE_LIMIT` /
 *  `LEVEL_RATE_LIMIT` in api/_ratelimit.ts) — the schedule reaches and then stays at a full window
 *  (60s) by the 4th attempt, then backs off further to 5 minutes for anything still failing after
 *  that, rather than ever converging back down to hammering. A 429 response overrides this
 *  entirely and uses the server's own `Retry-After` instead (see `scheduleAfterOutcome`). */
export const BACKOFF_SCHEDULE_MS: readonly number[] = [2_000, 5_000, 15_000, 60_000, 300_000];

function backoffForAttempt(attempt: number): number {
  const idx = Math.min(Math.max(attempt - 1, 0), BACKOFF_SCHEDULE_MS.length - 1);
  return BACKOFF_SCHEDULE_MS[idx] as number;
}

export interface QueuedSubmission {
  id: string;
  payload: SubmitScoreRequest;
  attempts: number;
  createdAt: number;
  nextAttemptAt: number;
}

interface QueueFileV1 {
  schemaVersion: 1;
  items: QueuedSubmission[];
}

export type QueueEventStatus =
  | "queued"
  | "submitting"
  | "succeeded"
  | "rate-limited"
  | "retry-scheduled"
  | "rejected"
  | "dropped";

export interface QueueEvent {
  id: string;
  status: QueueEventStatus;
  rank?: number;
  reason?: string;
}

export interface DrainSummary {
  /** Items eligible to send this pass (backoff already elapsed), before any early stop. */
  attempted: number;
  /** Items that actually got an HTTP request issued — can be less than `attempted` when a
   *  rate-limited response causes the rest of the pass to back off without sending. */
  sent: number;
  succeeded: number;
  rateLimited: number;
  rejected: number;
  dropped: number;
  /** Still queued after this pass (retry-scheduled + not-yet-eligible + skipped-after-stop). */
  remaining: number;
}

export interface SubmissionQueue {
  /** Enqueues and immediately (fire-and-forget) attempts a drain. Never throws, never blocks —
   *  returns the internal queue id synchronously. */
  submit(payload: SubmitScoreRequest): string;
  /** Attempts to send everything currently eligible (backoff elapsed). Single-flight: a call that
   *  arrives while a previous one is still running is a no-op that reports zero activity. */
  drain(): Promise<DrainSummary>;
  size(): number;
  /** Read-only snapshot, for tests/debugging — never a live reference into internal state. */
  peek(): QueuedSubmission[];
  subscribe(cb: (e: QueueEvent) => void): () => void;
  destroy(): void;
}

export interface CreateQueueOptions {
  baseUrl: string;
  /** Injectable clock — deterministic backoff tests without real sleeping. */
  now?: () => number;
  /** Injectable id generator — deterministic ids make tests reproducible. */
  idGenerator?: () => string;
  /** Injectable backing store — defaults to the same localStorage-or-memory-fallback substrate
   *  T-10 VAULT itself uses (see persist.ts header comment). */
  store?: BackingStore;
}

function defaultIdGenerator(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneItems(items: readonly QueuedSubmission[]): QueuedSubmission[] {
  return items.map((i) => ({ ...i, payload: { ...i.payload } }));
}

export function createSubmissionQueue(opts: CreateQueueOptions): SubmissionQueue {
  const now = opts.now ?? (() => Date.now());
  const idGenerator = opts.idGenerator ?? defaultIdGenerator;
  const { store } = opts.store ? { store: opts.store } : chooseBackingStore();

  let draining = false;
  const listeners = new Set<(e: QueueEvent) => void>();

  function emit(e: QueueEvent): void {
    for (const cb of listeners) {
      try {
        cb(e);
      } catch {
        // A subscriber's own error must never break the queue's internal bookkeeping.
      }
    }
  }

  function loadItems(): QueuedSubmission[] {
    const raw = readJson(store, QUEUE_STORAGE_KEY);
    if (
      typeof raw !== "object" ||
      raw === null ||
      Array.isArray(raw) ||
      !Array.isArray((raw as { items?: unknown }).items)
    ) {
      return [];
    }
    const items = (raw as QueueFileV1).items;
    // Defensive per-item shape check — corrupt/foreign data in this key must never crash the
    // caller (same "never throw on corrupt data" contract T-10 VAULT documents for its own keys).
    return items.filter(
      (i): i is QueuedSubmission =>
        typeof i === "object" &&
        i !== null &&
        typeof (i as QueuedSubmission).id === "string" &&
        typeof (i as QueuedSubmission).attempts === "number" &&
        typeof (i as QueuedSubmission).createdAt === "number" &&
        typeof (i as QueuedSubmission).nextAttemptAt === "number" &&
        typeof (i as QueuedSubmission).payload === "object",
    );
  }

  function saveItems(items: QueuedSubmission[]): void {
    const payload: QueueFileV1 = { schemaVersion: SCHEMA_VERSION, items };
    writeJson(store, QUEUE_STORAGE_KEY, payload);
  }

  function removeById(id: string): QueuedSubmission[] {
    const next = loadItems().filter((i) => i.id !== id);
    saveItems(next);
    return next;
  }

  function updateById(id: string, patch: Partial<QueuedSubmission>): QueuedSubmission[] {
    const next = loadItems().map((i) => (i.id === id ? { ...i, ...patch } : i));
    saveItems(next);
    return next;
  }

  function submit(payload: SubmitScoreRequest): string {
    const id = idGenerator();
    const item: QueuedSubmission = {
      id,
      payload,
      attempts: 0,
      createdAt: now(),
      nextAttemptAt: now(),
    };
    let items = [...loadItems(), item];
    if (items.length > MAX_QUEUE_SIZE) {
      // Bounded growth: drop-oldest. `items` is in insertion order, so slicing the tail keeps the
      // most recent MAX_QUEUE_SIZE entries.
      const overflow = items.slice(0, items.length - MAX_QUEUE_SIZE);
      for (const dropped of overflow) {
        emit({ id: dropped.id, status: "dropped", reason: "queue-full" });
      }
      items = items.slice(items.length - MAX_QUEUE_SIZE);
    }
    saveItems(items);
    emit({ id, status: "queued" });
    // Fire-and-forget: the caller (the completion panel, via whatever wires it in) never awaits
    // this. A rejection here would be a bug in drain() itself (it already catches per-item
    // failures), but guard anyway so a submit() call can never surface an unhandled rejection.
    void drain().catch(() => undefined);
    return id;
  }

  async function drain(): Promise<DrainSummary> {
    const empty: DrainSummary = {
      attempted: 0,
      sent: 0,
      succeeded: 0,
      rateLimited: 0,
      rejected: 0,
      dropped: 0,
      remaining: 0,
    };
    if (draining) {
      // Single-flight guarantee — see module header. Reports zero activity rather than queuing a
      // second concurrent pass.
      empty.remaining = loadItems().length;
      return empty;
    }
    draining = true;
    try {
      const t = now();
      let items = loadItems();

      // Prune permanently-stale items up front, independent of eligibility this pass.
      const stale = items.filter((i) => t - i.createdAt > MAX_AGE_MS);
      if (stale.length > 0) {
        items = items.filter((i) => t - i.createdAt <= MAX_AGE_MS);
        saveItems(items);
        for (const s of stale) {
          empty.dropped++;
          emit({ id: s.id, status: "dropped", reason: "max-age-exceeded" });
        }
      }

      const eligible = items.filter((i) => i.nextAttemptAt <= t);
      empty.attempted = eligible.length;

      let stopSending = false;
      let stoppedAtMs = t;
      for (const item of eligible) {
        if (stopSending) {
          // Already saturated this pass (a rate-limited response arrived) — reschedule using the
          // SAME backoff the rate-limited response itself carried, without sending a request for
          // this item at all. This is the "back off rather than hammer" property: the rest of the
          // eligible backlog is not turned into more requests just because it was already due —
          // and critically, it must not stay marked "eligible now" either, or the very next
          // drain() call (e.g. from an immediately-following reconnect event) would try to send it
          // right away and trip the limiter again.
          updateById(item.id, { nextAttemptAt: stoppedAtMs });
          emit({ id: item.id, status: "retry-scheduled" });
          continue;
        }

        empty.sent++;
        emit({ id: item.id, status: "submitting" });

        const outcome: HttpOutcome<unknown> = await postScore(opts.baseUrl, item.payload);

        if (outcome.kind === "ok") {
          const parsed = parseScoreResponse(outcome.value);
          if (parsed.accepted) {
            empty.succeeded++;
            removeById(item.id);
            emit({ id: item.id, status: "succeeded", rank: parsed.rank });
          } else {
            // Explicit `{accepted:false}` — a real answer from the server (verification failed,
            // malformed tape, level not found, ...). Permanent: resending the same bytes will
            // never produce a different verdict, so this item is removed, not retried.
            empty.rejected++;
            removeById(item.id);
            emit({ id: item.id, status: "rejected", reason: "not-accepted" });
          }
          continue;
        }

        if (outcome.kind === "rate-limited") {
          empty.rateLimited++;
          stoppedAtMs = t + outcome.retryAfterMs;
          updateById(item.id, { nextAttemptAt: stoppedAtMs });
          emit({ id: item.id, status: "rate-limited" });
          stopSending = true;
          continue;
        }

        if (isRetryable(outcome)) {
          const attempts = item.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            empty.dropped++;
            removeById(item.id);
            emit({ id: item.id, status: "dropped", reason: "max-attempts-exceeded" });
          } else {
            updateById(item.id, { attempts, nextAttemptAt: t + backoffForAttempt(attempts) });
            emit({ id: item.id, status: "retry-scheduled" });
          }
          continue;
        }

        // A non-retryable HTTP error (4xx other than 429) or a response that parsed but wasn't
        // recognisable — treated as permanent, same reasoning as an explicit `accepted:false`.
        empty.rejected++;
        removeById(item.id);
        emit({
          id: item.id,
          status: "rejected",
          reason: outcome.kind === "http-error" ? `http-${outcome.status}` : outcome.kind,
        });
      }

      empty.remaining = loadItems().length;
      return empty;
    } finally {
      draining = false;
    }
  }

  return {
    submit,
    drain,
    size(): number {
      return loadItems().length;
    },
    peek(): QueuedSubmission[] {
      return cloneItems(loadItems());
    },
    subscribe(cb: (e: QueueEvent) => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy(): void {
      listeners.clear();
    },
  };
}
