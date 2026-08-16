/**
 * T-13 PODIUM — tests for net/http.ts against a REAL local server (test/mock-api.ts), not a fetch
 * mock. Covers timeout (hung route + real connection-refused), the 429/Retry-After parse path, and
 * `isRetryable`'s classification of every HttpOutcome kind.
 */
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_RATE_LIMIT_BACKOFF_MS, isRetryable, requestJson } from "../src/net/http.js";
import { startMockApi, type MockApiHandle } from "./mock-api.js";

let handle: MockApiHandle | null = null;

afterEach(async () => {
  if (handle) {
    await handle.close();
    handle = null;
  }
});

describe("requestJson — happy path", () => {
  it("returns ok with the parsed body for a normal 200 response", async () => {
    handle = await startMockApi();
    handle.seedLeaderboard("builtin-00", "fastest", [
      { rank: 1, name: "Ada", timeMs: 1000, boostMs: 100, verified: true },
    ]);
    const outcome = await requestJson<{ entries: unknown[] }>(
      `${handle.url}/api/leaderboard?level=builtin-00&metric=fastest`,
    );
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.status).toBe(200);
      expect(outcome.value.entries).toHaveLength(1);
    }
  });
});

describe("requestJson — timeout", () => {
  it("aborts a hung request at the configured timeout and does not wait for it", async () => {
    handle = await startMockApi();
    handle.setScoreHandler(() => "hang");
    const start = Date.now();
    const outcome = await requestJson(
      `${handle.url}/api/score`,
      { method: "POST", body: "{}" },
      150, // short timeout for a fast test — proves the mechanism, real code uses REQUEST_TIMEOUT_MS
    );
    const elapsed = Date.now() - start;
    expect(outcome.kind).toBe("timeout");
    // Must return close to the configured timeout, not hang until some much larger default.
    expect(elapsed).toBeLessThan(1000);
    expect(elapsed).toBeGreaterThanOrEqual(140);
  });
});

describe("requestJson — genuinely unreachable (connection refused, not merely slow)", () => {
  it("returns network-error quickly against a closed port", async () => {
    const closedHandle = await startMockApi();
    const deadUrl = closedHandle.url;
    await closedHandle.close(); // now nothing listens on this port
    const start = Date.now();
    const outcome = await requestJson(`${deadUrl}/api/leaderboard?level=x&metric=fastest`);
    const elapsed = Date.now() - start;
    expect(outcome.kind).toBe("network-error");
    // A refused connection must fail fast — much faster than the request timeout, proving this is
    // a genuinely distinct failure mode from a hung request (task doc: "a hung DNS lookup behaves
    // differently from a refused connection").
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("requestJson — rate limited (429)", () => {
  it("parses Retry-After (seconds) into retryAfterMs", async () => {
    handle = await startMockApi();
    handle.setScoreHandler(() => ({
      status: 429,
      bodyRaw: JSON.stringify({ accepted: false, verified: false, reason: "rate-limited" }),
      headers: { "Retry-After": "42" },
    }));
    const outcome = await requestJson(`${handle.url}/api/score`, {
      method: "POST",
      body: "{}",
    });
    expect(outcome.kind).toBe("rate-limited");
    if (outcome.kind === "rate-limited") {
      expect(outcome.retryAfterMs).toBe(42_000);
    }
  });

  it("falls back to DEFAULT_RATE_LIMIT_BACKOFF_MS when Retry-After is missing or malformed", async () => {
    handle = await startMockApi();
    handle.setScoreHandler(() => ({
      status: 429,
      bodyRaw: JSON.stringify({ accepted: false }),
      headers: { "Retry-After": "not-a-number" },
    }));
    const outcome = await requestJson(`${handle.url}/api/score`, {
      method: "POST",
      body: "{}",
    });
    expect(outcome.kind).toBe("rate-limited");
    if (outcome.kind === "rate-limited") {
      expect(outcome.retryAfterMs).toBe(DEFAULT_RATE_LIMIT_BACKOFF_MS);
    }
  });
});

describe("requestJson — malformed JSON body", () => {
  it("returns invalid-json rather than throwing", async () => {
    handle = await startMockApi();
    handle.setScoreHandler(() => ({ status: 200, bodyRaw: "{ this is not json" }));
    const outcome = await requestJson(`${handle.url}/api/score`, {
      method: "POST",
      body: "{}",
    });
    expect(outcome.kind).toBe("invalid-json");
  });
});

describe("requestJson — non-2xx status", () => {
  it("returns http-error with the status and parsed body", async () => {
    handle = await startMockApi();
    handle.setLevelGetHandler(() => ({
      status: 404,
      bodyRaw: JSON.stringify({ error: "level-not-found" }),
    }));
    const outcome = await requestJson(`${handle.url}/api/levels/nope`);
    expect(outcome.kind).toBe("http-error");
    if (outcome.kind === "http-error") {
      expect(outcome.status).toBe(404);
      expect(outcome.body).toEqual({ error: "level-not-found" });
    }
  });

  it("classifies 5xx as retryable and 4xx (non-429) as permanent", () => {
    expect(isRetryable({ kind: "http-error", status: 500, body: null })).toBe(true);
    expect(isRetryable({ kind: "http-error", status: 503, body: null })).toBe(true);
    expect(isRetryable({ kind: "http-error", status: 400, body: null })).toBe(false);
    expect(isRetryable({ kind: "http-error", status: 404, body: null })).toBe(false);
  });
});

describe("isRetryable — every outcome kind", () => {
  it("network-shaped failures are retryable, ok is not", () => {
    expect(isRetryable({ kind: "ok", status: 200, value: null })).toBe(false);
    expect(isRetryable({ kind: "timeout" })).toBe(true);
    expect(isRetryable({ kind: "network-error" })).toBe(true);
    expect(isRetryable({ kind: "invalid-json" })).toBe(true);
    expect(isRetryable({ kind: "rate-limited", retryAfterMs: 1000 })).toBe(true);
  });
});
