/**
 * T-13 PODIUM — tests for net/queue.ts (deliverable 2: the offline submission queue). This is the
 * file that proves the property the whole task hinges on: "the game stays fully playable with the
 * API unreachable... a player on a train... [has] the score submitted later" (task briefing).
 *
 * Structure:
 *   - "offline -> queue -> reconnect -> drain" — the headline scenario, with real numbers.
 *   - "idempotency" — replaying a drain after success sends zero further requests.
 *   - "rate limiting" — driven against a mock configured with T-12's REAL limits (8/60s),
 *     proving the client backs off instead of hammering, with attempted-vs-sent numbers.
 *   - "bounded growth" — MAX_QUEUE_SIZE / MAX_ATTEMPTS / MAX_AGE_MS all independently exercised.
 *   - "never blocks" — submit() returns synchronously regardless of network state.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { ReplayTape } from "@swingby/core";
import {
  createSubmissionQueue,
  MAX_AGE_MS,
  MAX_ATTEMPTS,
  MAX_QUEUE_SIZE,
  QUEUE_STORAGE_KEY,
  type QueueEvent,
  type SubmissionQueue,
} from "../src/net/queue.js";
import type { SubmitScoreRequest } from "../src/net/index.js";
import { startMockApi, type MockApiHandle } from "./mock-api.js";

const TAPE: ReplayTape = { ticks: 100, boost: [10], brake: [50] };

function makeStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
}

function payload(overrides: Partial<SubmitScoreRequest> = {}): SubmitScoreRequest {
  return {
    levelId: "builtin-00",
    metric: "fastest",
    timeMs: 1000,
    boostMs: 100,
    name: "Ada",
    tape: TAPE,
    ...overrides,
  };
}

/** Polls until a synchronous predicate is true or a deadline passes — used instead of a fixed
 *  sleep so tests aren't flaky under container load, without waiting longer than necessary. */
async function waitUntil(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

let handle: MockApiHandle | null = null;
let queue: SubmissionQueue | null = null;

afterEach(async () => {
  queue?.destroy();
  queue = null;
  if (handle) {
    await handle.close();
    handle = null;
  }
});

describe("offline -> queue -> reconnect -> drain (the headline scenario)", () => {
  it("submit() while unreachable queues without blocking; a later drain() against a live server sends it", async () => {
    // "Offline" here means genuinely unreachable — a closed port, not a slow one, matching the
    // task doc's distinction between "offline toggle" and "dead host".
    const deadServer = await startMockApi();
    const deadUrl = deadServer.url;
    await deadServer.close();

    const store = makeStore();
    queue = createSubmissionQueue({ baseUrl: deadUrl, store });

    const events: QueueEvent[] = [];
    queue.subscribe((e) => events.push(e));

    const before = Date.now();
    const id = queue.submit(payload());
    const submitElapsed = Date.now() - before;

    // The headline property: submit() returns immediately regardless of network reachability.
    expect(submitElapsed).toBeLessThan(20);
    expect(typeof id).toBe("string");
    expect(queue.size()).toBe(1); // queued synchronously, survives even if the process died right here

    // The record really is on the backing store, not only in memory — "survives a reload" means
    // a fresh createSubmissionQueue() against the same store sees it.
    expect(store._map.has(QUEUE_STORAGE_KEY)).toBe(true);

    await waitUntil(() => events.some((e) => e.status === "retry-scheduled" || e.status === "queued"));

    // Now "reconnect": point a fresh queue instance (simulating a page reload) at a live server.
    handle = await startMockApi();
    const reconnected = createSubmissionQueue({ baseUrl: handle.url, store });
    expect(reconnected.size()).toBe(1); // reloaded from the (shared) backing store

    const summary = await reconnected.drain();
    expect(summary.attempted).toBe(1);
    expect(summary.sent).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(reconnected.size()).toBe(0); // drained: removed from the persisted queue

    // And the score genuinely landed server-side.
    const scoreReq = handle.requests.find((r) => r.path === "/api/score");
    expect(scoreReq).toBeDefined();
    reconnected.destroy();
  });
});

describe("idempotency — replaying a drain after success sends zero further requests", () => {
  it("a second drain() call, after a successful first one, issues 0 additional HTTP requests", async () => {
    handle = await startMockApi();
    const store = makeStore();
    queue = createSubmissionQueue({ baseUrl: handle.url, store });

    queue.submit(payload());
    await waitUntil(() => handle !== null && handle.requests.length >= 1);
    await waitUntil(() => queue !== null && queue.size() === 0);

    expect(handle.requests.filter((r) => r.path === "/api/score")).toHaveLength(1);

    // Replay: call drain() again explicitly (simulating a duplicate reconnect-listener firing, or
    // a second page load racing the first).
    const requestCountBefore = handle.requests.length;
    const replaySummary = await queue.drain();
    expect(replaySummary.attempted).toBe(0);
    expect(replaySummary.sent).toBe(0);
    expect(handle.requests.length).toBe(requestCountBefore); // literally zero new requests

    // And a third replay for good measure.
    await queue.drain();
    expect(handle.requests.length).toBe(requestCountBefore);
  });

  it("two concurrent drain() calls never both send the same item (single-flight)", async () => {
    handle = await startMockApi();
    // Add artificial latency by having the score route wait a beat before answering, widening the
    // window in which a second, overlapping drain() COULD (if not single-flight) double-send.
    let released!: () => void;
    const gate = new Promise<void>((resolve) => {
      released = resolve;
    });
    handle.setScoreHandler(async () => {
      await gate;
      return { status: 200, bodyRaw: JSON.stringify({ accepted: true, verified: true, rank: 1 }) };
    });

    const store = makeStore();
    queue = createSubmissionQueue({ baseUrl: handle.url, store, now: () => Date.now() });
    queue.submit(payload());
    await waitUntil(() => handle !== null && handle.requests.length >= 1);

    // A second drain() call arrives WHILE the first is still awaiting the gated response.
    const secondDrain = queue.drain();
    released();
    const secondSummary = await secondDrain;

    expect(secondSummary.attempted).toBe(0);
    expect(secondSummary.sent).toBe(0); // single-flight guard reported zero activity
    expect(handle.requests.filter((r) => r.path === "/api/score")).toHaveLength(1); // exactly one POST
  });
});

describe("rate limiting — driven against T-12's real limits (8/60s), proving backoff not hammering", () => {
  it("stops sending after the mock's configured limit trips, reschedules the rest without sending", async () => {
    // Real 8/60s limit, exactly matching api/_ratelimit.ts's SCORE_RATE_LIMIT.
    handle = await startMockApi({ scoreRateLimit: { limit: 8, windowMs: 60_000 } });
    const store = makeStore();
    const events: QueueEvent[] = [];
    queue = createSubmissionQueue({ baseUrl: handle.url, store });
    queue.subscribe((e) => events.push(e));

    // Queue 12 items directly onto the backing store (bypassing submit()'s own auto-drain so all
    // 12 are eligible for ONE drain() pass, rather than trickling in one auto-drain at a time).
    const now = Date.now();
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `item-${i}`,
      payload: payload({ timeMs: 1000 + i }),
      attempts: 0,
      createdAt: now,
      nextAttemptAt: now,
    }));
    store.setItem(QUEUE_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, items }));

    const summary = await queue.drain();

    // The number that matters: 12 were eligible, but only 9 requests were actually sent (8
    // succeed, the 9th trips the 429) — the remaining 3 were backed off WITHOUT a request.
    expect(summary.attempted).toBe(12);
    expect(summary.sent).toBe(9);
    expect(summary.succeeded).toBe(8);
    expect(summary.rateLimited).toBe(1);
    expect(summary.remaining).toBe(4); // 1 rate-limited + 3 never-sent, still queued for later

    const scoreRequests = handle.requests.filter((r) => r.path === "/api/score");
    expect(scoreRequests).toHaveLength(9); // real request count on the wire, not just accounting

    // The 3 items that were never even sent this pass must be scheduled for later, not lost.
    const remainingItems = queue.peek();
    expect(remainingItems).toHaveLength(4);
    for (const item of remainingItems) {
      expect(item.nextAttemptAt).toBeGreaterThan(now);
    }
  });
});

describe("timeout / hung server does not block gameplay", () => {
  it("submit() against a server that never responds still returns immediately", async () => {
    handle = await startMockApi();
    handle.setScoreHandler(() => "hang");
    const store = makeStore();
    queue = createSubmissionQueue({ baseUrl: handle.url, store });

    const before = Date.now();
    queue.submit(payload());
    expect(Date.now() - before).toBeLessThan(20);
    // The in-flight drain will eventually time out on its own (proven against the real
    // REQUEST_TIMEOUT_MS in net-index.test.ts) — this test only asserts submit() itself never
    // waits for it.
  });
});

describe("bounded growth", () => {
  it("MAX_QUEUE_SIZE: overflow drops the OLDEST item, never grows past the cap", async () => {
    handle = await startMockApi();
    handle.setScoreHandler(() => "hang"); // never resolves, so nothing drains away during this test
    const store = makeStore();
    const events: QueueEvent[] = [];
    queue = createSubmissionQueue({ baseUrl: handle.url, store });
    queue.subscribe((e) => events.push(e));

    const ids: string[] = [];
    for (let i = 0; i < MAX_QUEUE_SIZE + 5; i++) {
      ids.push(queue.submit(payload({ timeMs: 1000 + i })));
    }

    expect(queue.size()).toBe(MAX_QUEUE_SIZE);
    const kept = queue.peek().map((i) => i.id);
    // The 5 oldest (first submitted) must be gone; the most recent MAX_QUEUE_SIZE must remain.
    expect(kept).not.toContain(ids[0]);
    expect(kept).not.toContain(ids[4]);
    expect(kept).toContain(ids[ids.length - 1]);
    expect(events.filter((e) => e.status === "dropped" && e.reason === "queue-full")).toHaveLength(5);
  });

  it("MAX_ATTEMPTS: a persistently-failing item is dropped after the configured attempt cap, not retried forever", async () => {
    handle = await startMockApi();
    handle.setScoreHandler(() => ({ status: 500, bodyRaw: JSON.stringify({ error: "boom" }) }));
    const store = makeStore();
    const events: QueueEvent[] = [];
    // Fake clock so backoff delays don't require real sleeping.
    let clock = Date.now();
    queue = createSubmissionQueue({ baseUrl: handle.url, store, now: () => clock });
    queue.subscribe((e) => events.push(e));

    queue.submit(payload());
    await waitUntil(() => events.some((e) => e.status === "retry-scheduled" || e.status === "dropped"));

    // Manually advance the fake clock past each backoff step and drain again, MAX_ATTEMPTS times.
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) {
      clock += 10 * 60_000; // jump well past any backoff step
      await queue.drain();
      if (queue.size() === 0) break;
    }

    expect(queue.size()).toBe(0);
    expect(events.filter((e) => e.status === "dropped" && e.reason === "max-attempts-exceeded")).toHaveLength(1);
    // Bounded: never exceeded MAX_ATTEMPTS real HTTP attempts for this one item.
    const attemptsOnWire = handle.requests.filter((r) => r.path === "/api/score").length;
    expect(attemptsOnWire).toBeLessThanOrEqual(MAX_ATTEMPTS);
  });

  it("MAX_AGE_MS: an old item is pruned on the next drain regardless of attempts", async () => {
    handle = await startMockApi();
    const store = makeStore();
    let clock = Date.now();
    queue = createSubmissionQueue({ baseUrl: handle.url, store, now: () => clock });
    const events: QueueEvent[] = [];
    queue.subscribe((e) => events.push(e));

    // Seed directly with an old createdAt (older than MAX_AGE_MS), never-attempted.
    store.setItem(
      QUEUE_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        items: [
          {
            id: "ancient",
            payload: payload(),
            attempts: 0,
            createdAt: clock - MAX_AGE_MS - 1000,
            nextAttemptAt: clock - 1000,
          },
        ],
      }),
    );

    await queue.drain();
    expect(queue.size()).toBe(0);
    expect(events.some((e) => e.id === "ancient" && e.status === "dropped" && e.reason === "max-age-exceeded")).toBe(
      true,
    );
    // Never even attempted over the wire — pruned before it would have been sent.
    expect(handle.requests.filter((r) => r.path === "/api/score")).toHaveLength(0);
  });
});

describe("permanent rejection is not retried", () => {
  it("an explicit {accepted:false} response (e.g. verification failed) is dequeued, not retried", async () => {
    handle = await startMockApi();
    handle.setScoreHandler(() => ({
      status: 200,
      bodyRaw: JSON.stringify({ accepted: false, verified: false, reason: "out-of-bounds" }),
    }));
    const store = makeStore();
    const events: QueueEvent[] = [];
    queue = createSubmissionQueue({ baseUrl: handle.url, store });
    queue.subscribe((e) => events.push(e));

    queue.submit(payload());
    await waitUntil(() => events.some((e) => e.status === "rejected"));
    expect(queue.size()).toBe(0);
    expect(handle.requests.filter((r) => r.path === "/api/score")).toHaveLength(1); // never retried
  });
});
