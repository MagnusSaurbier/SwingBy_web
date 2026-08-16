/**
 * T-09 GAUGE — hud/index.ts's `mountGauge` composition tests: the cross-module wiring that isn't
 * exercised by hud.ts/pause.ts/complete.ts's own individual test files.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_LEVELS } from "@swingby/core";
import {
  createFakeDom,
  type FakeElement,
} from "../src/hud/__tests__/fakeDom.js";
import { mountGauge } from "../src/hud/index.js";
import { createFakeSession } from "./fake-session.js";
import { createStorage } from "../src/storage/index.js";

const level = BUILTIN_LEVELS[0]!;

let fakeDoc: ReturnType<typeof createFakeDom>;
beforeEach(() => {
  fakeDoc = createFakeDom();
  vi.stubGlobal("document", fakeDoc);
});
afterEach(() => vi.unstubAllGlobals());

function findByClass(
  el: FakeElement,
  className: string,
): FakeElement | undefined {
  if (el.classList.contains(className)) return el;
  for (const child of el.children) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return undefined;
}

describe("mountGauge", () => {
  it("suppresses hud.ts's small pause badge while the full pause panel is open", () => {
    const session = createFakeSession({ status: "playing" });
    const gauge = mountGauge({
      session,
      level,
      levelLabel: "Stage 01",
      levelKey: "builtin-00",
      storage: createStorage(),
      onSettings: () => {},
      onChooseLevel: () => {},
      onMainMenu: () => {},
    });
    const indicator = findByClass(
      gauge.el as unknown as FakeElement,
      "sb-hud-pause-indicator",
    )!;

    session.pause();
    expect(gauge.pause.isOpen()).toBe(true);
    // Suppressed: the small badge must NOT also be showing "Paused" behind the full panel.
    expect(indicator.classList.contains("sb-visible")).toBe(false);

    session.resume();
    expect(indicator.classList.contains("sb-visible")).toBe(false);
  });

  it("shows a 'Target reached' toast on completion, alongside the completion panel", () => {
    const session = createFakeSession({ status: "playing" });
    const gauge = mountGauge({
      session,
      level,
      levelLabel: "Stage 01",
      levelKey: "builtin-00",
      storage: createStorage(),
      onSettings: () => {},
      onChooseLevel: () => {},
      onMainMenu: () => {},
    });
    session.fireComplete({
      timeMs: 9000,
      boostMs: 0,
      tape: { ticks: 1, boost: [], brake: [] },
    });
    expect(gauge.complete.isOpen()).toBe(true);
    expect(gauge.toast.currentMessage()).toBe("Target reached");
  });

  it("refreshes hud.ts's cached personal-best AFTER complete.ts's own recordBest() has run, so the HUD's 'Best' line is never stale post-completion", () => {
    const storage = createStorage();
    const session = createFakeSession({ status: "playing" });
    const gauge = mountGauge({
      session,
      level,
      levelLabel: "Stage 01",
      levelKey: "builtin-00",
      storage,
      onSettings: () => {},
      onChooseLevel: () => {},
      onMainMenu: () => {},
    });

    expect(storage.getBest("builtin-00")).toBeNull();
    session.fireComplete({
      timeMs: 9000,
      boostMs: 150,
      tape: { ticks: 1, boost: [], brake: [] },
    });
    // recordBest() ran (via complete.ts) as part of the SAME synchronous onComplete dispatch.
    expect(storage.getBest("builtin-00")).toEqual({
      timeMs: 9000,
      boostMs: 150,
    });

    // hud.ts's own cached "best" must already reflect it too — no manual refreshBest() call
    // needed by the composition's caller.
    const bestEl = findByClass(
      gauge.el as unknown as FakeElement,
      "sb-hud-best",
    )!;
    expect(bestEl.textContent).toContain("0:09.000");
    expect(bestEl.textContent).toContain("0:00.150");
  });

  it("destroy() tears down hud/pause/complete/toast together", () => {
    const session = createFakeSession({ status: "playing" });
    const gauge = mountGauge({
      session,
      level,
      levelLabel: "Stage 01",
      levelKey: "builtin-00",
      storage: createStorage(),
      onSettings: () => {},
      onChooseLevel: () => {},
      onMainMenu: () => {},
    });
    gauge.destroy();
    // The composition's own coordinating subscriber plus hud/pause each subscribed once = 0 left.
    expect(session.subscriberCount()).toBe(0);
  });
});
