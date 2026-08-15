import { describe, expect, it } from "vitest";

import { createRateLimiter, getClientIp, type ClientIpSource } from "../_ratelimit.js";

describe("createRateLimiter", () => {
  it("allows exactly `limit` requests in a window, then rejects — proving the threshold triggers", () => {
    const rl = createRateLimiter({ limit: 8, windowMs: 60_000 });
    const now = 1_000_000;

    const results = Array.from({ length: 12 }, () => rl.check("1.2.3.4", now));
    const allowedCount = results.filter((r) => r.allowed).length;
    const rejectedCount = results.filter((r) => !r.allowed).length;

    expect(allowedCount).toBe(8);
    expect(rejectedCount).toBe(4);
    // Matches the task's "fire 50 in 10s, confirm 429s" shape at a smaller, deterministic scale.
    expect(results[8]?.allowed).toBe(false);
    expect(results[11]?.allowed).toBe(false);
  });

  it("reports a positive retryAfterMs once rejected", () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 10_000 });
    const now = 5_000_000;
    rl.check("k", now);
    rl.check("k", now + 100);
    const third = rl.check("k", now + 200);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBeGreaterThan(0);
    expect(third.retryAfterMs).toBeLessThanOrEqual(10_000);
  });

  it("is a SLIDING window: old hits age out and free up budget without waiting for the whole window to reset globally", () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 1000 });
    rl.check("k", 0);
    rl.check("k", 100);
    expect(rl.check("k", 200).allowed).toBe(false); // budget spent
    expect(rl.check("k", 1101).allowed).toBe(true); // first hit (t=0) has aged out by t=1101
  });

  it("tracks distinct keys (IPs) independently", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000 });
    const now = 0;
    expect(rl.check("ip-a", now).allowed).toBe(true);
    expect(rl.check("ip-a", now).allowed).toBe(false);
    expect(rl.check("ip-b", now).allowed).toBe(true); // different key, fresh budget
  });

  it("evicts the oldest tracked key once maxTrackedKeys is exceeded, bounding memory under a low-rate scan across many distinct IPs", () => {
    const rl = createRateLimiter({ limit: 5, windowMs: 60_000, maxTrackedKeys: 3 });
    rl.check("ip-1", 0);
    rl.check("ip-2", 0);
    rl.check("ip-3", 0);
    expect(rl.size()).toBe(3);
    rl.check("ip-4", 0);
    expect(rl.size()).toBe(3); // ip-1 evicted, not just appended
  });

  it("reset() clears all tracked state (test helper)", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000 });
    rl.check("k", 0);
    expect(rl.check("k", 0).allowed).toBe(false);
    rl.reset();
    expect(rl.check("k", 0).allowed).toBe(true);
  });
});

describe("getClientIp", () => {
  it("prefers the first entry of x-forwarded-for", () => {
    const req: ClientIpSource = { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" }, socket: {} };
    expect(getClientIp(req)).toBe("203.0.113.5");
  });

  it("handles x-forwarded-for as an array (some proxies deliver it that way)", () => {
    const req: ClientIpSource = {
      headers: { "x-forwarded-for": ["203.0.113.9", "10.0.0.1"] },
      socket: {},
    };
    expect(getClientIp(req)).toBe("203.0.113.9");
  });

  it("falls back to the socket address when no forwarding header is present", () => {
    const req: ClientIpSource = { headers: {}, socket: { remoteAddress: "127.0.0.1" } };
    expect(getClientIp(req)).toBe("127.0.0.1");
  });

  it("never throws — falls back to \"unknown\" when nothing is available", () => {
    const req: ClientIpSource = { headers: {}, socket: {} };
    expect(getClientIp(req)).toBe("unknown");
  });
});
