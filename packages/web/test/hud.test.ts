/**
 * T-09 GAUGE — hud.ts tests. Fake DOM (no jsdom) + the fake `GameSession` (deliverable 5) driven
 * through the scripted scenarios the brief calls out explicitly: bounds-warning ramp, reset flash,
 * paused state. Also the deliverable-6 measurement: N updates through the fake session, µs/update
 * and DOM-write count from the fake DOM's own instrumented `stats.writes` counter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_LEVELS, DEFAULT_SETTINGS, TPS, type Settings } from "@swingby/core";
import { createFakeDom, type FakeElement } from "../src/hud/__tests__/fakeDom.js";
import { mountHud } from "../src/hud/hud.js";
import {
  createFakeSession,
  driveBoundsWarningRamp,
  driveResetFlash,
  drivePaused,
  type FakeSession,
} from "./fake-session.js";
import type { Storage, PersonalBest } from "../src/storage/index.js";

const level = BUILTIN_LEVELS[0]!;

function makeStorageStub(overrides?: {
  settings?: Partial<Settings>;
  best?: PersonalBest | null;
}): Pick<Storage, "getSettings" | "getBest"> {
  const settings: Settings = { ...DEFAULT_SETTINGS, ...overrides?.settings };
  const best = overrides?.best ?? null;
  return {
    getSettings: () => settings,
    getBest: () => best,
  };
}

let fakeDoc: ReturnType<typeof createFakeDom>;

beforeEach(() => {
  fakeDoc = createFakeDom();
  vi.stubGlobal("document", fakeDoc);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mount(session: FakeSession, storageOverrides?: Parameters<typeof makeStorageStub>[0]) {
  return mountHud({
    session,
    level,
    levelLabel: "Stage 01",
    levelKey: "builtin-00",
    storage: makeStorageStub(storageOverrides),
  });
}

describe("mountHud", () => {
  it("renders level name/author and initial time/boost text immediately at mount, before any subscribe callback", () => {
    const session = createFakeSession({ status: "playing" });
    const hud = mount(session);
    const el = hud.el as unknown as FakeElement;
    const text = el.textContent + collectText(el);
    expect(text).toContain("Orbital Primer");
    expect(text).toContain("SwingBy");
    expect(text).toContain("Time 0:00.000");
    expect(text).toContain("Boost 0:00.000");
  });

  it("bounds-warning ramp 0->1 drives the glow element's opacity style in lockstep, every step (no throttling on this tier)", () => {
    const session = createFakeSession({ status: "playing" });
    const hud = mount(session);
    const boundsGlow = (hud.el as unknown as FakeElement).children.find((c) =>
      c.classList.contains("sb-hud-bounds-glow"),
    )!;
    const snaps = driveBoundsWarningRamp(session, 10);
    expect(boundsGlow.style.opacity).toBe(String(snaps[snaps.length - 1]!.boundsWarning));
    expect(boundsGlow.style.opacity).toBe("1");
  });

  it("reset flash: elapsedTicks/boostTicks visibly reset to 0:00.000 once the throttled tier next runs", () => {
    const session = createFakeSession({ status: "playing", elapsedTicks: 5000 });
    const hud = mount(session);
    driveResetFlash(session);
    // Force the throttled tier to run (mount already consumed frame #1; drive 14 more calls).
    for (let i = 0; i < 14; i++) session.patch({});
    const el = hud.el as unknown as FakeElement;
    expect(collectText(el)).toContain("Time 0:00.000");
  });

  it("paused snapshot shows the pause indicator; playing hides it again", () => {
    const session = createFakeSession({ status: "playing" });
    const hud = mount(session);
    const indicator = findByClass(hud.el as unknown as FakeElement, "sb-hud-pause-indicator")!;
    expect(indicator.classList.contains("sb-visible")).toBe(false);

    drivePaused(session);
    expect(indicator.classList.contains("sb-visible")).toBe(true);

    session.patch({ status: "playing" });
    expect(indicator.classList.contains("sb-visible")).toBe(false);
  });

  it("hint hides on the SAME status-change call that pauses, even with no further throttled ticks afterward (regression: found via the 360px pause-panel screenshot)", () => {
    const session = createFakeSession({ status: "playing", elapsedTicks: TPS * 10, boostTicks: 50 });
    const hud = mount(session);
    // Force the throttled tier to run once so the hint has real visible text to begin with.
    for (let i = 0; i < 14; i++) session.patch({});
    const hintEl = findByClass(hud.el as unknown as FakeElement, "sb-hud-hint")!;
    expect(hintEl.classList.contains("sb-visible")).toBe(true);
    expect(hintEl.textContent.length).toBeGreaterThan(0);

    // A single pause() call, deliberately NOT followed by any further patch() — mirrors a
    // scripted/manually-driven session (e.g. the dev harness) where nothing guarantees the next
    // notification lands on a throttled tick.
    session.pause();
    expect(hintEl.classList.contains("sb-visible")).toBe(false);
  });

  it("hint text is correctly re-evaluated the SAME call status returns to playing, not delayed up to a full throttle window", () => {
    const session = createFakeSession({ status: "playing", boundsWarning: 0.9 });
    const hud = mount(session);
    for (let i = 0; i < 14; i++) session.patch({}); // let the throttled tier pick up the bounds hint
    const hintEl = findByClass(hud.el as unknown as FakeElement, "sb-hud-hint")!;
    expect(hintEl.textContent).toMatch(/too far/i);

    session.pause();
    expect(hintEl.classList.contains("sb-visible")).toBe(false);

    session.patch({ status: "playing", boundsWarning: 0 }); // resume, now safely inside bounds
    expect(hintEl.classList.contains("sb-visible")).toBe(true);
    expect(hintEl.textContent).not.toMatch(/too far/i);
  });

  it("setPauseIndicatorSuppressed hides the indicator even while paused", () => {
    const session = createFakeSession({ status: "playing" });
    const hud = mount(session);
    const indicator = findByClass(hud.el as unknown as FakeElement, "sb-hud-pause-indicator")!;
    hud.setPauseIndicatorSuppressed(true);
    drivePaused(session);
    expect(indicator.classList.contains("sb-visible")).toBe(false);
  });

  it("level label fades after LABEL_FADE_TICKS (TPS*3) of playing, and un-fades on restart (ticks back to 0)", () => {
    const session = createFakeSession({ status: "playing", elapsedTicks: 0 });
    const hud = mount(session);
    const levelBox = findByClass(hud.el as unknown as FakeElement, "sb-hud-level")!;
    expect(levelBox.classList.contains("sb-faded")).toBe(false);

    session.patch({ elapsedTicks: TPS * 3 + 1 });
    expect(levelBox.classList.contains("sb-faded")).toBe(true);

    session.patch({ status: "resetting", elapsedTicks: 0 });
    session.patch({ status: "playing", elapsedTicks: 0 });
    expect(levelBox.classList.contains("sb-faded")).toBe(false);
  });

  it("showTimes=false hides the timer/boost/best block; showFps toggles the fps block independently", () => {
    const session = createFakeSession({ status: "playing" });
    const hud = mount(session, { settings: { showTimes: false, showFps: true } });
    // Force initial render to have applied (mount already ran onSnapshot once).
    const timerEl = findByClass(hud.el as unknown as FakeElement, "sb-hud-timer")!;
    const fpsEl = findByClass(hud.el as unknown as FakeElement, "sb-hud-fps")!;
    expect(timerEl.classList.contains("sb-hidden")).toBe(true);
    expect(fpsEl.classList.contains("sb-hidden")).toBe(false);
  });

  it("personal best text reflects storage.getBest(), refreshed on demand via refreshBest()", () => {
    const session = createFakeSession({ status: "playing" });
    let best: PersonalBest | null = null;
    const hud = mountHud({
      session,
      level,
      levelLabel: "Stage 01",
      levelKey: "builtin-00",
      storage: { getSettings: () => DEFAULT_SETTINGS, getBest: () => best },
    });
    let bestEl = findByClass(hud.el as unknown as FakeElement, "sb-hud-best")!;
    expect(bestEl.textContent).toBe("Best —");

    best = { timeMs: 14653, boostMs: 0 };
    hud.refreshBest();
    // Advance to the next throttled tick to pick up the refreshed value.
    for (let i = 0; i < 14; i++) session.patch({});
    bestEl = findByClass(hud.el as unknown as FakeElement, "sb-hud-best")!;
    expect(bestEl.textContent).toContain("0:14.653");
  });

  it("destroy() unsubscribes — further snapshots no longer touch the DOM", () => {
    const session = createFakeSession({ status: "playing" });
    const hud = mount(session);
    expect(session.subscriberCount()).toBe(1);
    hud.destroy();
    expect(session.subscriberCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Deliverable 6 — measured update cost. Reported here AND in results/T-09-GAUGE.md; this test
// asserts a generous upper bound (10x the 1ms/frame budget) so a real regression fails the suite,
// while the actual number is printed for the results file.
// ---------------------------------------------------------------------------

describe("deliverable 6: measured HUD update cost", () => {
  it("N updates through the fake session: report us/update, DOM writes/update, and steady-state writes for an UNCHANGED snapshot", () => {
    const session = createFakeSession({ status: "playing" });
    const hud = mount(session, { settings: { showFps: true } });
    fakeDoc.resetStats();

    const N = 10_000;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      session.patch({
        elapsedTicks: i,
        boostTicks: Math.floor(i / 3),
        fps: 144,
        boundsWarning: (i % 100) / 100,
      });
    }
    const elapsedMs = performance.now() - start;
    const usPerUpdate = (elapsedMs * 1000) / N;
    const writesPerUpdate = fakeDoc.stats.writes / N;

    // eslint-disable-next-line no-console
    console.log(
      `[hud.test] ${N} updates: ${elapsedMs.toFixed(2)}ms total, ${usPerUpdate.toFixed(3)} us/update, ` +
        `${fakeDoc.stats.writes} total DOM writes, ${writesPerUpdate.toFixed(3)} writes/update`,
    );

    expect(usPerUpdate).toBeLessThan(100); // generous vs. the 1000us (1ms) budget — real number goes in results.md

    // Steady state: repeating the SAME snapshot must cost (near) zero DOM writes (compare-before-write).
    // The throttled tier is up to THROTTLE_FRAMES calls stale, so freezing on an arbitrary snapshot
    // mid-cycle needs one more throttled tick to "catch up" to that frozen value before it's truly
    // steady — drive that catch-up BEFORE resetting the counter, so the measurement below isolates
    // genuine steady-state cost, not the one legitimate catch-up write.
    const steady = session.snapshot();
    for (let i = 0; i < 14; i++) session.push({ ...steady });
    fakeDoc.resetStats();
    for (let i = 0; i < 1000; i++) session.push({ ...steady });
    // eslint-disable-next-line no-console
    console.log(`[hud.test] 1000 repeats of an UNCHANGED (already-stable) snapshot: ${fakeDoc.stats.writes} DOM writes`);
    expect(fakeDoc.stats.writes).toBe(0);

    hud.destroy();
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function findByClass(el: FakeElement, className: string): FakeElement | undefined {
  if (el.classList.contains(className)) return el;
  for (const child of el.children) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return undefined;
}

function collectText(el: FakeElement): string {
  let out = el.textContent;
  for (const child of el.children) out += " " + collectText(child);
  return out;
}
