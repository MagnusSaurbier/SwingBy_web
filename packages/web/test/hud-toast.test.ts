/**
 * T-09 GAUGE — toast.ts tests. Uses the hand-rolled fake DOM (`hud/__tests__/fakeDom.ts`, no jsdom
 * in this project) stubbed onto `globalThis.document`, and vitest's fake timers so the 1.9s/toast
 * lifecycle (200ms enter + 1300ms hold + 400ms exit) drains deterministically without real wall-clock
 * waits.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeDom,
  type FakeElement,
} from "../src/hud/__tests__/fakeDom.js";
import { createToastQueue } from "../src/hud/toast.js";

let fakeDoc: ReturnType<typeof createFakeDom>;

beforeEach(() => {
  fakeDoc = createFakeDom();
  vi.stubGlobal("document", fakeDoc);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const TOTAL_MS = 200 + 1300 + 400; // enter + hold + exit, matches toast.ts defaults

describe("toast queue", () => {
  it("shows a single toast, then it drains after enter+hold+exit", () => {
    const q = createToastQueue();
    q.show("Target reached");
    expect(q.currentMessage()).toBe("Target reached");

    vi.advanceTimersByTime(TOTAL_MS - 1);
    expect(q.currentMessage()).toBe("Target reached"); // still mid-exit

    vi.advanceTimersByTime(1);
    expect(q.currentMessage()).toBeNull();
    expect(q.pendingCount()).toBe(0);
  });

  it("preserves FIFO ordering across a queued burst", () => {
    const q = createToastQueue();
    const seen: string[] = [];
    q.show("one");
    q.show("two");
    q.show("three");

    // Sample the currently-visible message every time it changes by stepping through full cycles.
    for (let i = 0; i < 3; i++) {
      const msg = q.currentMessage();
      if (msg) seen.push(msg);
      vi.advanceTimersByTime(TOTAL_MS);
    }
    expect(seen).toEqual(["one", "two", "three"]);
    expect(q.pendingCount()).toBe(0);
    expect(q.currentMessage()).toBeNull();
  });

  it("a flood (20 toasts fired at once) never mounts more than one toast node and fully drains in FIFO order", () => {
    const q = createToastQueue();
    const el = q.el as unknown as FakeElement;

    for (let i = 0; i < 20; i++) q.show(`Toast ${i}`);

    const seen: string[] = [];
    // Sample at every phase boundary across all 20 cycles, checking node count each time.
    for (let i = 0; i < 20; i++) {
      const msg = q.currentMessage();
      if (msg) seen.push(msg);
      // el always has exactly ONE child (the reused toast node) — "does not stack into a wall".
      expect(el.children.length).toBe(1);
      vi.advanceTimersByTime(TOTAL_MS);
    }

    expect(seen).toEqual(Array.from({ length: 20 }, (_, i) => `Toast ${i}`));
    expect(q.pendingCount()).toBe(0);
    expect(q.currentMessage()).toBeNull();
    expect(el.children.length).toBe(1); // node is reused, never removed/re-added
  });

  it("does not overlap: at no sampled instant is more than one message considered current", () => {
    const q = createToastQueue();
    q.show("a");
    q.show("b");
    // Immediately after firing both, only "a" (the first) is current — "b" is still queued, not
    // simultaneously visible.
    expect(q.currentMessage()).toBe("a");
    expect(q.pendingCount()).toBe(1);
  });

  it("empty/whitespace-only messages are dropped, not queued", () => {
    const q = createToastQueue();
    q.show("   ");
    q.show("");
    expect(q.currentMessage()).toBeNull();
    expect(q.pendingCount()).toBe(0);
  });

  it("a flood beyond the queue cap drops overflow rather than growing unboundedly", () => {
    const q = createToastQueue({ maxQueued: 3 });
    q.show("first"); // becomes current immediately
    q.show("q1");
    q.show("q2");
    q.show("q3");
    q.show("q4"); // dropped — cap already reached
    expect(q.pendingCount()).toBe(3);
  });

  it("destroy() clears the queue, stops the timer chain, and removes the container", () => {
    const q = createToastQueue();
    const el = q.el as unknown as FakeElement;
    const parent = fakeDoc.createElement("div");
    parent.appendChild(el);
    expect(el.parentNode).toBe(parent);
    q.show("a");
    q.show("b");
    q.destroy();
    expect(el.parentNode).toBeNull();
    // Advancing timers after destroy must not throw or resurrect anything.
    expect(() => vi.advanceTimersByTime(TOTAL_MS * 3)).not.toThrow();
    q.show("after-destroy");
    expect(q.currentMessage()).toBeNull();
  });
});
