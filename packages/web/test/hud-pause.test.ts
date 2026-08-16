/**
 * T-09 GAUGE — pause.ts tests. Fake DOM + fake session. Exercises the reuse of T-08's real
 * `mountIngameMenu` (not a mock — the actual landed module), so a shape change there would show up
 * here as a real test failure, not silently.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeDom,
  type FakeElement,
} from "../src/hud/__tests__/fakeDom.js";
import { mountPausePanel } from "../src/hud/pause.js";
import { createFakeSession } from "./fake-session.js";

let fakeDoc: ReturnType<typeof createFakeDom>;

beforeEach(() => {
  fakeDoc = createFakeDom();
  vi.stubGlobal("document", fakeDoc);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function findButtonByText(
  el: FakeElement,
  text: string,
): FakeElement | undefined {
  if (el.tagName === "BUTTON" && el.textContent.includes(text)) return el;
  for (const child of el.children) {
    const found = findButtonByText(child, text);
    if (found) return found;
  }
  return undefined;
}

describe("mountPausePanel", () => {
  it("is closed while playing, opens automatically when status becomes paused", () => {
    const session = createFakeSession({ status: "playing" });
    const panel = mountPausePanel({
      session,
      levelLabel: "Stage 01",
      onSettings: () => {},
      onChooseLevel: () => {},
      onMainMenu: () => {},
    });
    expect(panel.isOpen()).toBe(false);

    session.pause();
    expect(panel.isOpen()).toBe(true);
    expect((panel.el as unknown as FakeElement).children.length).toBe(1);
  });

  it("Resume calls session.resume() and closes the panel without disturbing elapsedTicks", () => {
    const session = createFakeSession({ status: "playing", elapsedTicks: 500 });
    const panel = mountPausePanel({
      session,
      levelLabel: "Stage 01",
      onSettings: () => {},
      onChooseLevel: () => {},
      onMainMenu: () => {},
    });
    session.pause();
    expect(panel.isOpen()).toBe(true);

    const resumeBtn = findButtonByText(
      panel.el as unknown as FakeElement,
      "Resume",
    )!;
    resumeBtn.dispatchEvent({ type: "click" });

    expect(session.calls.resume).toBe(1);
    expect(panel.isOpen()).toBe(false);
    expect(session.snapshot().status).toBe("playing");
    expect(session.snapshot().elapsedTicks).toBe(500); // untouched by pause/resume
  });

  it("Restart calls session.restart() and closes the panel", () => {
    const session = createFakeSession({ status: "playing", elapsedTicks: 500 });
    const panel = mountPausePanel({
      session,
      levelLabel: "Stage 01",
      onSettings: () => {},
      onChooseLevel: () => {},
      onMainMenu: () => {},
    });
    session.pause();
    const restartBtn = findButtonByText(
      panel.el as unknown as FakeElement,
      "Restart",
    )!;
    restartBtn.dispatchEvent({ type: "click" });

    expect(session.calls.restart).toBe(1);
    expect(panel.isOpen()).toBe(false);
    expect(session.snapshot().elapsedTicks).toBe(0);
  });

  it("Settings/Choose level/Main menu forward to the caller-supplied callbacks untouched", () => {
    const session = createFakeSession({ status: "paused" });
    const calls = { settings: 0, chooseLevel: 0, mainMenu: 0 };
    const panel = mountPausePanel({
      session,
      levelLabel: "Stage 01",
      onSettings: () => calls.settings++,
      onChooseLevel: () => calls.chooseLevel++,
      onMainMenu: () => calls.mainMenu++,
    });
    expect(panel.isOpen()).toBe(true);

    findButtonByText(
      panel.el as unknown as FakeElement,
      "Settings",
    )!.dispatchEvent({ type: "click" });
    findButtonByText(
      panel.el as unknown as FakeElement,
      "Choose level",
    )!.dispatchEvent({ type: "click" });
    findButtonByText(
      panel.el as unknown as FakeElement,
      "Main menu",
    )!.dispatchEvent({ type: "click" });

    expect(calls).toEqual({ settings: 1, chooseLevel: 1, mainMenu: 1 });
  });

  it("open() (manual trigger, e.g. an on-screen pause button) pauses the session and shows immediately", () => {
    const session = createFakeSession({ status: "playing" });
    const panel = mountPausePanel({
      session,
      levelLabel: "Stage 01",
      onSettings: () => {},
      onChooseLevel: () => {},
      onMainMenu: () => {},
    });
    panel.open();
    expect(session.calls.pause).toBe(1);
    expect(session.snapshot().status).toBe("paused");
    expect(panel.isOpen()).toBe(true);
  });

  it("never calls session.pause() on its own in response to status changes — only Resume/Restart/open() touch the session, and pausing is driven externally", () => {
    const session = createFakeSession({ status: "playing" });
    mountPausePanel({
      session,
      levelLabel: "Stage 01",
      onSettings: () => {},
      onChooseLevel: () => {},
      onMainMenu: () => {},
    });
    session.pause(); // external trigger, e.g. the bound "pause" key handled inside loop.ts
    expect(session.calls.pause).toBe(1); // exactly the one WE just called, not an extra from pause.ts
  });

  it("destroy() unsubscribes and closes any open overlay", () => {
    const session = createFakeSession({ status: "paused" });
    const panel = mountPausePanel({
      session,
      levelLabel: "Stage 01",
      onSettings: () => {},
      onChooseLevel: () => {},
      onMainMenu: () => {},
    });
    expect(panel.isOpen()).toBe(true);
    panel.destroy();
    expect(panel.isOpen()).toBe(false);
    expect(session.subscriberCount()).toBe(0);
  });
});
