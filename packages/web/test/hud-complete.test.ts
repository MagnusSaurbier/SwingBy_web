/**
 * T-09 GAUGE — complete.ts tests. Fake DOM + fake session + a fake `Storage.getBest`/`recordBest`
 * pair. Exercises the "new best vs non-best" distinction using a REAL (not re-derived) recordBest
 * result shape, the once-per-attempt guarantee, and the T-13 rank slot placeholder.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_LEVELS } from "@swingby/core";
import {
  createFakeDom,
  type FakeElement,
} from "../src/hud/__tests__/fakeDom.js";
import { mountCompletePanel } from "../src/hud/complete.js";
import { createFakeSession } from "./fake-session.js";
import { createStorage } from "../src/storage/index.js";
import type { PersonalBest, Storage } from "../src/storage/index.js";

const level = BUILTIN_LEVELS[0]!;

let fakeDoc: ReturnType<typeof createFakeDom>;
beforeEach(() => {
  fakeDoc = createFakeDom();
  vi.stubGlobal("document", fakeDoc);
});
afterEach(() => vi.unstubAllGlobals());

/** A tiny in-memory stand-in with T-10's REAL comparison semantics (ported inline, not imported,
 *  to keep this test's fixture independent of storage/index.ts's internals) — timeIsNew/boostIsNew
 *  computed exactly like `createStorage()`'s own `recordBest` does. */
function makeBestStore(
  initial: PersonalBest | null,
): Pick<Storage, "getBest" | "recordBest"> {
  let best = initial;
  return {
    getBest: () => (best ? { ...best } : null),
    recordBest(_levelId, r) {
      const timeIsNew = !best || r.timeMs < best.timeMs;
      const boostIsNew = !best || r.boostMs < best.boostMs;
      if (timeIsNew || boostIsNew) {
        best = {
          timeMs: timeIsNew ? r.timeMs : best!.timeMs,
          boostMs: boostIsNew ? r.boostMs : best!.boostMs,
        };
      }
      return { timeIsNew, boostIsNew };
    },
  };
}

function findText(el: FakeElement, needle: string): boolean {
  return el.textContent.includes(needle);
}

describe("mountCompletePanel", () => {
  it("hidden until onComplete fires; shows exactly once per completion", () => {
    const session = createFakeSession({ status: "playing" });
    const panel = mountCompletePanel({
      session,
      level,
      levelLabel: "Stage 01",
      levelKey: "builtin-00",
      storage: makeBestStore(null),
      onChooseLevel: () => {},
    });
    expect(panel.isOpen()).toBe(false);

    session.fireComplete({
      timeMs: 14653,
      boostMs: 0,
      tape: { ticks: 2110, boost: [], brake: [] },
    });
    expect(panel.isOpen()).toBe(true);
    expect(panel.completionCount()).toBe(1);
  });

  it("first-ever completion: both time and boost are a new best (no previous record)", () => {
    const session = createFakeSession({ status: "playing" });
    const panel = mountCompletePanel({
      session,
      level,
      levelLabel: "Stage 01",
      levelKey: "builtin-00",
      storage: makeBestStore(null),
      onChooseLevel: () => {},
    });
    session.fireComplete({
      timeMs: 14653,
      boostMs: 500,
      tape: { ticks: 1, boost: [], brake: [] },
    });
    const el = panel.el as unknown as FakeElement;
    expect(findText(el, "NEW BEST")).toBe(true);
    expect(findText(el, "0:14.653")).toBe(true);
    expect(findText(el, "Previous best")).toBe(false); // nothing to compare against yet
  });

  it("a slower/worse repeat is NOT flagged as a new best, and shows the real previous best", () => {
    const session = createFakeSession({ status: "playing" });
    const panel = mountCompletePanel({
      session,
      level,
      levelLabel: "Stage 01",
      levelKey: "builtin-00",
      storage: makeBestStore({ timeMs: 10000, boostMs: 200 }),
      onChooseLevel: () => {},
    });
    session.fireComplete({
      timeMs: 15000,
      boostMs: 900,
      tape: { ticks: 1, boost: [], brake: [] },
    });
    const el = panel.el as unknown as FakeElement;
    expect(findText(el, "NEW BEST")).toBe(false);
    expect(findText(el, "Previous best")).toBe(true);
    expect(findText(el, "0:10.000")).toBe(true); // the previous best's time is shown
  });

  it("a mixed result (faster time, more boost used) flags only the time as a new best", () => {
    const session = createFakeSession({ status: "playing" });
    const panel = mountCompletePanel({
      session,
      level,
      levelLabel: "Stage 01",
      levelKey: "builtin-00",
      storage: makeBestStore({ timeMs: 10000, boostMs: 200 }),
      onChooseLevel: () => {},
    });
    session.fireComplete({
      timeMs: 9000,
      boostMs: 800,
      tape: { ticks: 1, boost: [], brake: [] },
    });
    const el = panel.el as unknown as FakeElement;
    const badgeCount = countBadges(el);
    expect(badgeCount).toBe(1);
  });

  it("displays exactly the timeMs/boostMs handed to it — never recomputes from ticks (readout agreement)", () => {
    const session = createFakeSession({ status: "playing" });
    const panel = mountCompletePanel({
      session,
      level,
      levelLabel: "Stage 01",
      levelKey: "builtin-00",
      storage: makeBestStore(null),
      onChooseLevel: () => {},
    });
    // A deliberately "wrong-looking" ticks value in the tape — the panel must not derive its
    // displayed time from tape.ticks, only from the payload's own timeMs/boostMs fields.
    session.fireComplete({
      timeMs: 12345,
      boostMs: 678,
      tape: { ticks: 999999, boost: [], brake: [] },
    });
    const el = panel.el as unknown as FakeElement;
    expect(findText(el, "0:12.345")).toBe(true);
    expect(findText(el, "0:00.678")).toBe(true);
  });

  it("rank slot defaults to unavailable and never blocks the initial render; setRank updates it in place", () => {
    const session = createFakeSession({ status: "playing" });
    const panel = mountCompletePanel({
      session,
      level,
      levelLabel: "Stage 01",
      levelKey: "builtin-00",
      storage: makeBestStore(null),
      onChooseLevel: () => {},
    });
    session.fireComplete({
      timeMs: 1000,
      boostMs: 0,
      tape: { ticks: 1, boost: [], brake: [] },
    });
    expect(findText(panel.el as unknown as FakeElement, "Leaderboard")).toBe(
      false,
    );

    panel.setRank({ status: "loading" });
    expect(findText(panel.el as unknown as FakeElement, "Submitting")).toBe(
      true,
    );

    panel.setRank({ status: "loaded", rank: 7 });
    expect(findText(panel.el as unknown as FakeElement, "#7")).toBe(true);
  });

  it("Retry calls session.restart() and hides the panel", () => {
    const session = createFakeSession({ status: "playing" });
    const panel = mountCompletePanel({
      session,
      level,
      levelLabel: "Stage 01",
      levelKey: "builtin-00",
      storage: makeBestStore(null),
      onChooseLevel: () => {},
    });
    session.fireComplete({
      timeMs: 1000,
      boostMs: 0,
      tape: { ticks: 1, boost: [], brake: [] },
    });
    const retryBtn = findButton(panel.el as unknown as FakeElement, "Retry")!;
    retryBtn.dispatchEvent({ type: "click" });
    expect(session.calls.restart).toBe(1);
    expect(panel.isOpen()).toBe(false);
  });

  it("hides automatically when status leaves 'complete' for any reason (e.g. an external restart, not just its own Retry button)", () => {
    const session = createFakeSession({ status: "playing" });
    const panel = mountCompletePanel({
      session,
      level,
      levelLabel: "Stage 01",
      levelKey: "builtin-00",
      storage: makeBestStore(null),
      onChooseLevel: () => {},
    });
    session.fireComplete({
      timeMs: 1000,
      boostMs: 0,
      tape: { ticks: 1, boost: [], brake: [] },
    });
    expect(panel.isOpen()).toBe(true);
    session.restart(); // external, not via the panel's own Retry button
    expect(panel.isOpen()).toBe(false);
  });

  it("omits the Next button entirely when onNext is not supplied", () => {
    const session = createFakeSession({ status: "playing" });
    const panel = mountCompletePanel({
      session,
      level,
      levelLabel: "Stage 01",
      levelKey: "builtin-00",
      storage: makeBestStore(null),
      onChooseLevel: () => {},
    });
    session.fireComplete({
      timeMs: 1000,
      boostMs: 0,
      tape: { ticks: 1, boost: [], brake: [] },
    });
    expect(
      findButton(panel.el as unknown as FakeElement, "Next level"),
    ).toBeUndefined();
  });

  it("ten completions in a row (via restart+fireComplete) open the panel exactly ten times, never twice for one capture", () => {
    const session = createFakeSession({ status: "playing" });
    const panel = mountCompletePanel({
      session,
      level,
      levelLabel: "Stage 01",
      levelKey: "builtin-00",
      storage: makeBestStore(null),
      onChooseLevel: () => {},
    });
    for (let i = 0; i < 10; i++) {
      session.fireComplete({
        timeMs: 1000 - i,
        boostMs: 0,
        tape: { ticks: 1, boost: [], brake: [] },
      });
      expect(panel.isOpen()).toBe(true);
      session.restart();
      expect(panel.isOpen()).toBe(false);
      session.patch({ status: "playing" });
    }
    expect(panel.completionCount()).toBe(10);
  });
});

describe("mountCompletePanel + T-10 VAULT's REAL createStorage()", () => {
  it("using the real recordBest() return, a new best is flagged and persists; a worse repeat on the same real store is not", () => {
    const storage = createStorage(); // real module, real (degraded-to-memory) backing store
    const session = createFakeSession({ status: "playing" });
    const panel = mountCompletePanel({
      session,
      level,
      levelLabel: "Stage 01",
      levelKey: "builtin-00",
      storage,
      onChooseLevel: () => {},
    });

    // First completion: nothing recorded yet, so both are new bests, per real recordBest().
    session.fireComplete({
      timeMs: 20000,
      boostMs: 1000,
      tape: { ticks: 1, boost: [], brake: [] },
    });
    expect(findText(panel.el as unknown as FakeElement, "NEW BEST")).toBe(true);
    expect(storage.getBest("builtin-00")).toEqual({
      timeMs: 20000,
      boostMs: 1000,
    });

    session.restart();
    session.patch({ status: "playing" });

    // Second completion, strictly worse on both axes: real recordBest() must report neither as new,
    // and the real store must be unchanged (not regressed).
    session.fireComplete({
      timeMs: 25000,
      boostMs: 1500,
      tape: { ticks: 1, boost: [], brake: [] },
    });
    expect(findText(panel.el as unknown as FakeElement, "NEW BEST")).toBe(
      false,
    );
    expect(storage.getBest("builtin-00")).toEqual({
      timeMs: 20000,
      boostMs: 1000,
    });

    session.restart();
    session.patch({ status: "playing" });

    // Third completion, strictly better: real recordBest() must flag both and update the real store.
    session.fireComplete({
      timeMs: 12000,
      boostMs: 400,
      tape: { ticks: 1, boost: [], brake: [] },
    });
    const el = panel.el as unknown as FakeElement;
    expect(countBadges(el)).toBe(2);
    expect(storage.getBest("builtin-00")).toEqual({
      timeMs: 12000,
      boostMs: 400,
    });
  });
});

function countBadges(el: FakeElement): number {
  let n = el.classList.contains("sb-complete-badge") ? 1 : 0;
  for (const c of el.children) n += countBadges(c);
  return n;
}

function findButton(el: FakeElement, text: string): FakeElement | undefined {
  if (el.tagName === "BUTTON" && el.textContent.includes(text)) return el;
  for (const c of el.children) {
    const found = findButton(c, text);
    if (found) return found;
  }
  return undefined;
}
