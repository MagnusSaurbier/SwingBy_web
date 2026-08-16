/**
 * T-13 PODIUM — pure-logic tests for worldBest.ts. `formatWorldBest` has no DOM dependency, so it
 * runs under plain-Node vitest (no jsdom in this project — same finding every other `ui/**` task
 * records: T-08's log, "no jsdom/happy-dom installed"). `mountWorldBestBadge`/`panel.ts`'s DOM
 * construction is NOT unit tested here for the same reason T-08 didn't unit test its screens/*.ts —
 * it's verified against a REAL browser instead (headless Chromium, see notes/T-13-PODIUM/log.md
 * "Screenshot plan"), which is also where the XSS-safety proof (name renders as literal text, not
 * markup) lives — a real HTML parser is strictly stronger evidence for that claim than a hand-
 * rolled DOM stub would be.
 */
import { describe, expect, it } from "vitest";

import type { LeaderboardEntry } from "../../../net/index.js";
import { formatWorldBest } from "../worldBest.js";

function entry(overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    rank: 1,
    name: "Ada",
    timeMs: 12_345,
    boostMs: 1_000,
    verified: true,
    ...overrides,
  };
}

describe("formatWorldBest", () => {
  it("null for an empty leaderboard (offline, or genuinely no scores yet)", () => {
    expect(formatWorldBest([])).toBeNull();
  });

  it("formats the FIRST entry, trusting server order rather than re-deriving a minimum", () => {
    // Deliberately NOT sorted ascending by timeMs — the server's own ordering (verified-first) is
    // what must be trusted; picking entries[0] rather than Math.min(...) is the whole point.
    const entries = [
      entry({ rank: 1, timeMs: 5000, verified: true }),
      entry({ rank: 2, timeMs: 1000, verified: false }),
    ];
    expect(formatWorldBest(entries)).toBe("world best 5.000s");
  });

  it("uses the same formatMs convention as the rest of the UI (ms -> s, 3 decimals)", () => {
    expect(formatWorldBest([entry({ timeMs: 1000 })])).toBe(
      "world best 1.000s",
    );
  });
});
