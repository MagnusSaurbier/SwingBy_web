// Unit tests for packages/web/src/game/input.ts and touch-zones.ts.
//
// One test file covers both modules. This file lives at
// `packages/web/src/game/__tests__/input.test.ts` rather than `packages/web/test/input.test.ts`
// (a deliberate divergence — see notes/archive/T-06-HELM/log.md — it matches the storage module's
// test-file precedent already on disk, and this repo's default vitest discovery needs no extra
// config either way).
//
// There is no DOM in the plain-Node vitest environment this repo uses (see
// notes/archive/T-04-AURORA/log.md and notes/archive/T-10-VAULT/log.md — no jsdom dependency, by
// design). A small hand-written fake EventTarget/element double stands in for the DOM, and plain
// objects shaped like KeyboardEvent/TouchEvent are dispatched at it. This exercises the real
// matching/queueing/zero-allocation logic in input.ts without needing jsdom or any other new
// dependency.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlAction } from "@swingby/core";
import { DEFAULT_CONTROLS } from "@swingby/core";
import { createInputSource, type InputSource } from "../input.js";
import { classifyPoint, pointInRect } from "../touch-zones.js";

// ---------------------------------------------------------------------------------------------
// Fake DOM double
// ---------------------------------------------------------------------------------------------

type Handler = (event: never) => void;

/** Minimal EventTarget-shaped double with real add/remove/listenerCount/emit semantics — the
 *  parts of the HTMLElement contract input.ts actually uses. Not a Proxy/auto-mock: add/remove
 *  are real Set operations so `destroy()` can be proven to actually stop delivery, not just
 *  assumed to. */
class FakeElement {
  style: Record<string, string> = {};
  tagName = "CANVAS";
  private listeners = new Map<string, Set<Handler>>();

  addEventListener(type: string, handler: Handler): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
  }

  removeEventListener(type: string, handler: Handler): void {
    this.listeners.get(type)?.delete(handler);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  totalListenerCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  emit(type: string, event: unknown): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const handler of Array.from(set)) handler(event as never);
  }
}

function keyEvent(
  code: string,
  opts: Partial<{ key: string; repeat: boolean; target: unknown }> = {},
): KeyboardEvent {
  return {
    code,
    key: opts.key ?? code,
    repeat: opts.repeat ?? false,
    target: "target" in opts ? opts.target : null,
    preventDefault(): void {},
  } as unknown as KeyboardEvent;
}

function touch(identifier: number, clientX: number, clientY: number): Touch {
  return { identifier, clientX, clientY } as unknown as Touch;
}

function touchEvent(changed: Touch[], all: Touch[]): TouchEvent {
  return {
    changedTouches: changed,
    touches: all,
    preventDefault(): void {},
  } as unknown as TouchEvent;
}

function rect(
  left: number,
  top: number,
  right: number,
  bottom: number,
): DOMRect {
  return {
    left,
    top,
    right,
    bottom,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    toJSON(): unknown {
      return {};
    },
  } as unknown as DOMRect;
}

function setup(): {
  fake: FakeElement;
  target: HTMLElement;
  source: InputSource;
} {
  const fake = new FakeElement();
  const target = fake as unknown as HTMLElement;
  const source = createInputSource(target);
  return { fake, target, source };
}

let current: InputSource | null = null;
afterEach(() => {
  current?.destroy();
  current = null;
});

// ---------------------------------------------------------------------------------------------
// Continuous vs. edge — the core contract
// ---------------------------------------------------------------------------------------------

describe("continuous input (poll)", () => {
  it("reflects held-right-now state and clears on keyup", () => {
    const { fake, source } = setup();
    current = source;
    expect(source.poll().boost).toBe(false);
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.boost));
    expect(source.poll().boost).toBe(true);
    fake.emit("keyup", keyEvent(DEFAULT_CONTROLS.boost));
    expect(source.poll().boost).toBe(false);
  });

  it("holding boost for many polls keeps reporting true every time (5s-hold check)", () => {
    const { fake, source } = setup();
    current = source;
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.boost));
    for (let i = 0; i < 500; i++) {
      expect(source.poll().boost).toBe(true);
    }
  });

  it("thrustX/thrustY follow the Godot formula: right-left, down-up, exact -1/0/1", () => {
    const { fake, source } = setup();
    current = source;
    expect(source.poll()).toMatchObject({ thrustX: 0, thrustY: 0 });
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.thrustRight));
    expect(source.poll().thrustX).toBe(1);
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.thrustLeft));
    expect(source.poll().thrustX).toBe(0); // both held -> cancels, matches PhysicsEngine.gd:110
    fake.emit("keyup", keyEvent(DEFAULT_CONTROLS.thrustRight));
    expect(source.poll().thrustX).toBe(-1);
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.thrustDown));
    expect(source.poll().thrustY).toBe(1);
  });

  it("poll() returns the SAME object reference every call (the zero-allocation design)", () => {
    const { source } = setup();
    current = source;
    const a = source.poll();
    const b = source.poll();
    expect(a).toBe(b);
  });
});

describe("edge-triggered input (drainEvents)", () => {
  it("a single keydown yields exactly one action, and draining empties the queue", () => {
    const { fake, source } = setup();
    current = source;
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.restart));
    expect(source.drainEvents()).toEqual(["restart"]);
    expect(source.drainEvents()).toEqual([]); // drained — not returned twice
  });

  it("held restart key for many repeat keydowns fires exactly once (OS key-repeat guard)", () => {
    const { fake, source } = setup();
    current = source;
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.restart, { repeat: false }));
    for (let i = 0; i < 500; i++) {
      fake.emit(
        "keydown",
        keyEvent(DEFAULT_CONTROLS.restart, { repeat: true }),
      );
    }
    expect(source.drainEvents()).toEqual(["restart"]);
  });

  it("continuous state is unaffected by drainEvents — holding boost never appears in the edge queue", () => {
    const { fake, source } = setup();
    current = source;
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.boost));
    expect(source.drainEvents()).toEqual([]);
    expect(source.poll().boost).toBe(true);
  });

  it("two distinct actions arriving between polls are both delivered exactly once, in order (no loss, no duplication)", () => {
    const { fake, source } = setup();
    current = source;
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.restart));
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.pause));
    expect(source.drainEvents()).toEqual(["restart", "pause"]);
    expect(source.drainEvents()).toEqual([]);
  });

  it("the same edge action pressed twice (release + re-press) between polls yields two entries, not zero and not three", () => {
    const { fake, source } = setup();
    current = source;
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.menu));
    fake.emit("keyup", keyEvent(DEFAULT_CONTROLS.menu));
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.menu));
    expect(source.drainEvents()).toEqual(["menu", "menu"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Bindings: code-based, layout-independent
// ---------------------------------------------------------------------------------------------

describe("bindings are KeyboardEvent.code, not .key", () => {
  it("matches on .code even when .key differs (simulated non-QWERTY layout)", () => {
    const { fake, source } = setup();
    current = source;
    // Physical Space key: on a hypothetical layout .key could report anything; .code is always
    // "Space". Prove the match is code-driven by sending a mismatched key value.
    fake.emit("keydown", keyEvent("Space", { key: "e" /* not "Space" */ }));
    expect(source.poll().boost).toBe(true);
  });

  it("an event whose .key happens to equal the bound code string, but whose .code differs, does NOT match", () => {
    const { fake, source } = setup();
    current = source;
    // AZERTY-style swap: physical key sends code "Digit1" but its .key text is literally "Space"
    // for this contrived case. If the implementation ever used .key by mistake, this would
    // incorrectly register as boost.
    fake.emit("keydown", keyEvent("Digit1", { key: "Space" }));
    expect(source.poll().boost).toBe(false);
  });

  it("rebinding boost to a new code works, and the old code no longer triggers it", () => {
    const { fake, source } = setup();
    current = source;
    source.setBindings({ ...DEFAULT_CONTROLS, boost: "KeyJ" });
    fake.emit("keydown", keyEvent("KeyJ"));
    expect(source.poll().boost).toBe(true);
    fake.emit("keyup", keyEvent("KeyJ"));
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.boost)); // old "Space" binding
    expect(source.poll().boost).toBe(false);
  });

  it("rebinding also re-routes edge actions through the reverse lookup", () => {
    const { fake, source } = setup();
    current = source;
    source.setBindings({ ...DEFAULT_CONTROLS, restart: "KeyZ" });
    fake.emit("keydown", keyEvent("KeyZ"));
    expect(source.drainEvents()).toEqual(["restart"]);
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.restart)); // old "KeyR" — no longer bound
    expect(source.drainEvents()).toEqual([]);
  });

  it("conflict policy: binding two actions to the same code unbinds the earlier one (ACTION_ORDER: boost before brake)", () => {
    const { fake, source } = setup();
    current = source;
    source.setBindings({ ...DEFAULT_CONTROLS, boost: "Space", brake: "Space" });
    fake.emit("keydown", keyEvent("Space"));
    const s = source.poll();
    expect(s.brake).toBe(true);
    expect(s.boost).toBe(false); // boost lost the code to brake, per documented policy
  });

  it("setBindings with a missing/invalid entry for one action preserves its PREVIOUS binding, not the factory default", () => {
    const { fake, source } = setup();
    current = source;
    source.setBindings({ ...DEFAULT_CONTROLS, boost: "KeyJ" });
    // Simulate a caller passing a malformed record missing `restart` entirely.
    const partial = { ...DEFAULT_CONTROLS, boost: "KeyJ" } as Record<
      ControlAction,
      string
    >;
    delete (partial as Record<string, string>).restart;
    source.setBindings(partial);
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.restart)); // still the original "KeyR"
    expect(source.drainEvents()).toEqual(["restart"]);
  });

  it("this module never touches localStorage (rebinding persists via the storage module's settings object)", () => {
    const src = fileURLToPath(new URL("../input.ts", import.meta.url));
    const text = readFileSync(src, "utf-8");
    expect(text).not.toMatch(/localStorage/);
  });
});

// ---------------------------------------------------------------------------------------------
// touch-zones.ts, exercised directly (split out of input.ts — see module header comment)
// ---------------------------------------------------------------------------------------------

describe("touch-zones.ts: pointInRect / classifyPoint", () => {
  const BOOST = rect(0, 0, 100, 100);
  const BRAKE = rect(200, 0, 300, 100);

  it("pointInRect includes all four edges (inclusive bounds)", () => {
    expect(pointInRect(0, 0, BOOST)).toBe(true); // top-left corner
    expect(pointInRect(100, 100, BOOST)).toBe(true); // bottom-right corner
    expect(pointInRect(50, 0, BOOST)).toBe(true); // top edge
    expect(pointInRect(0, 50, BOOST)).toBe(true); // left edge
    expect(pointInRect(101, 50, BOOST)).toBe(false); // just past the right edge
    expect(pointInRect(50, -1, BOOST)).toBe(false); // just above the top edge
  });

  it("classifyPoint returns null when zones haven't been attached yet", () => {
    expect(classifyPoint(null, 50, 50)).toBeNull();
  });

  it("classifyPoint distinguishes boost from brake and null outside both", () => {
    const zones = { boost: BOOST, brake: BRAKE };
    expect(classifyPoint(zones, 50, 50)).toBe("boost");
    expect(classifyPoint(zones, 250, 50)).toBe("brake");
    expect(classifyPoint(zones, 9999, 9999)).toBeNull();
  });

  it("documented tie-break: boost wins on overlapping zones", () => {
    const overlapping = {
      boost: rect(0, 0, 100, 100),
      brake: rect(50, 0, 150, 100),
    };
    expect(classifyPoint(overlapping, 75, 50)).toBe("boost"); // inside both rects
  });
});

// ---------------------------------------------------------------------------------------------
// Touch (input.ts's event wiring — attachTouch/touchstart/touchmove/touchend/touchcancel — built
// on top of touch-zones.ts's pure hit-testing, tested above)
// ---------------------------------------------------------------------------------------------

describe("touch", () => {
  const BOOST_ZONE = rect(0, 0, 100, 100);
  const BRAKE_ZONE = rect(200, 0, 300, 100);

  it("simultaneous boost + brake from two different touch identifiers both register", () => {
    const { fake, source } = setup();
    current = source;
    source.attachTouch({ boost: BOOST_ZONE, brake: BRAKE_ZONE });
    const t1 = touch(1, 50, 50);
    const t2 = touch(2, 250, 50);
    fake.emit("touchstart", touchEvent([t1, t2], [t1, t2]));
    const s = source.poll();
    expect(s.boost).toBe(true);
    expect(s.brake).toBe(true);
  });

  it("touchend releases only the identifier that ended, not the other zone", () => {
    const { fake, source } = setup();
    current = source;
    source.attachTouch({ boost: BOOST_ZONE, brake: BRAKE_ZONE });
    const t1 = touch(1, 50, 50);
    const t2 = touch(2, 250, 50);
    fake.emit("touchstart", touchEvent([t1, t2], [t1, t2]));
    fake.emit("touchend", touchEvent([t1], [t2]));
    const s = source.poll();
    expect(s.boost).toBe(false);
    expect(s.brake).toBe(true);
  });

  it("touchcancel releases — no stuck boosting after an interrupting call", () => {
    const { fake, source } = setup();
    current = source;
    source.attachTouch({ boost: BOOST_ZONE, brake: BRAKE_ZONE });
    const t1 = touch(1, 50, 50);
    fake.emit("touchstart", touchEvent([t1], [t1]));
    expect(source.poll().boost).toBe(true);
    fake.emit("touchcancel", touchEvent([t1], []));
    expect(source.poll().boost).toBe(false);
  });

  it("dragging a tracked touch off its zone releases it (touchmove)", () => {
    const { fake, source } = setup();
    current = source;
    source.attachTouch({ boost: BOOST_ZONE, brake: BRAKE_ZONE });
    const start = touch(1, 50, 50);
    fake.emit("touchstart", touchEvent([start], [start]));
    expect(source.poll().boost).toBe(true);
    const dragged = touch(1, 500, 500); // well outside the boost rect
    fake.emit("touchmove", touchEvent([dragged], [dragged]));
    expect(source.poll().boost).toBe(false);
  });

  it("a touch starting outside both zones is ignored and does not affect state", () => {
    const { fake, source } = setup();
    current = source;
    source.attachTouch({ boost: BOOST_ZONE, brake: BRAKE_ZONE });
    const stray = touch(1, 9999, 9999);
    fake.emit("touchstart", touchEvent([stray], [stray]));
    const s = source.poll();
    expect(s.boost).toBe(false);
    expect(s.brake).toBe(false);
  });

  // -------------------------------------------------------------------------------------------
  // Regression: UI controls painted over the canvas must keep their taps.
  //
  // `ui/screens/play.ts` hands this module touch zones that are the canvas rect (left half brake,
  // right half boost), and the HUD's pause panel and completion panel are painted ON TOP of that
  // same canvas — so every one of their buttons is geometrically inside a zone. Before the fix,
  // touchstart claimed those taps and called `preventDefault()`, and `preventDefault()` on
  // touchstart is exactly what stops the browser synthesizing the mouse/click events. The buttons
  // still took their CSS `:active` state from the touch, so they animated and did nothing: on a
  // phone, none of the in-game menu buttons (Resume / Restart level / Settings / Choose level /
  // Main menu) or the completion panel's buttons worked at all. Mouse and keyboard were fine,
  // which is what made it look like a HUD problem rather than an input-source one.
  //
  // The fix is a hit-test guard: a touch whose own target is (or is inside) a real interactive
  // control is the UI's, never a boost/brake press. As with the settings-toggle fix in
  // `components.css`, the point is that this module cannot see the caller's overlays — only two
  // rectangles — but the touch target already carries the answer.
  //
  // `FakeControl` below is a small stand-in for the part of the DOM the guard uses: a parent
  // chain plus a real `closest()` walk (this repo has no jsdom — see this file's header). The
  // full behaviour is covered by the browser verification, where the real pause and completion
  // panels are tapped under touch emulation.
  describe("a touch on a UI control over the canvas is left to the UI", () => {
    class FakeControl {
      constructor(
        readonly tagName: string,
        readonly parent: FakeControl | null = null,
      ) {}
      /** Simplified `Element.closest`: walks self-then-ancestors, matching on tag name only. */
      closest(selector: string): FakeControl | null {
        const wanted = selector.split(",").map((s) =>
          s
            .trim()
            .replace(/[[(].*$/, "")
            .toLowerCase(),
        );
        for (
          let node: FakeControl | null = this;
          node !== null;
          node = node.parent
        ) {
          if (wanted.includes(node.tagName.toLowerCase())) return node;
        }
        return null;
      }
    }

    const canvas = new FakeControl("CANVAS");
    const button = new FakeControl("BUTTON");
    /** The icon <svg> inside an iconed button — taps land on the child, not the button itself. */
    const iconInButton = new FakeControl("SVG", button);

    function touchOn(
      identifier: number,
      clientX: number,
      clientY: number,
      target: unknown,
    ): Touch {
      return { identifier, clientX, clientY, target } as unknown as Touch;
    }

    function spyTouchEvent(
      changed: Touch[],
      all: Touch[],
    ): { event: TouchEvent; prevented: () => number } {
      let count = 0;
      const event = {
        changedTouches: changed,
        touches: all,
        preventDefault(): void {
          count += 1;
        },
      } as unknown as TouchEvent;
      return { event, prevented: () => count };
    }

    it("does not claim it, and does not preventDefault (which is what killed the click)", () => {
      const { fake, source } = setup();
      current = source;
      source.attachTouch({ boost: BOOST_ZONE, brake: BRAKE_ZONE });
      // Dead centre of the boost zone — geometry alone would claim this.
      const { event, prevented } = spyTouchEvent(
        [touchOn(1, 50, 50, button)],
        [],
      );
      fake.emit("touchstart", event);
      expect(source.poll().boost).toBe(false);
      expect(prevented()).toBe(0);
    });

    it("walks up from the tapped child, so an icon inside a button counts too", () => {
      const { fake, source } = setup();
      current = source;
      source.attachTouch({ boost: BOOST_ZONE, brake: BRAKE_ZONE });
      const { event, prevented } = spyTouchEvent(
        [touchOn(1, 50, 50, iconInButton)],
        [],
      );
      fake.emit("touchstart", event);
      expect(source.poll().boost).toBe(false);
      expect(prevented()).toBe(0);
    });

    it("still claims a touch on the canvas itself, and still preventDefaults it", () => {
      const { fake, source } = setup();
      current = source;
      source.attachTouch({ boost: BOOST_ZONE, brake: BRAKE_ZONE });
      const { event, prevented } = spyTouchEvent(
        [touchOn(1, 50, 50, canvas)],
        [],
      );
      fake.emit("touchstart", event);
      expect(source.poll().boost).toBe(true);
      expect(prevented()).toBe(1);
    });

    it("is decided per touch: a second finger on the canvas still boosts", () => {
      const { fake, source } = setup();
      current = source;
      source.attachTouch({ boost: BOOST_ZONE, brake: BRAKE_ZONE });
      const onButton = touchOn(1, 250, 50, button); // in the brake zone
      const onCanvas = touchOn(2, 50, 50, canvas); // in the boost zone
      const { event } = spyTouchEvent([onButton, onCanvas], []);
      fake.emit("touchstart", event);
      const s = source.poll();
      expect(s.brake).toBe(false);
      expect(s.boost).toBe(true);
    });

    it("a touch with no target at all is still claimed (guard never blocks by default)", () => {
      const { fake, source } = setup();
      current = source;
      source.attachTouch({ boost: BOOST_ZONE, brake: BRAKE_ZONE });
      fake.emit("touchstart", touchEvent([touch(1, 50, 50)], []));
      expect(source.poll().boost).toBe(true);
    });
  });

  it("attachTouch can be called repeatedly (e.g. on resize) without adding new listeners", () => {
    const { fake, source } = setup();
    current = source;
    const before = fake.listenerCount("touchstart");
    source.attachTouch({ boost: BOOST_ZONE, brake: BRAKE_ZONE });
    source.attachTouch({ boost: rect(0, 0, 50, 50), brake: BRAKE_ZONE });
    source.attachTouch({ boost: rect(0, 0, 10, 10), brake: BRAKE_ZONE });
    expect(fake.listenerCount("touchstart")).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------
// Stuck-input paths: blur
// ---------------------------------------------------------------------------------------------

describe("blur releases every held input (keyboard + touch)", () => {
  it("target-level blur clears keyboard AND touch state (Node has no `window` — see log)", () => {
    const { fake, source } = setup();
    current = source;
    source.attachTouch({
      boost: rect(0, 0, 100, 100),
      brake: rect(200, 0, 300, 100),
    });
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.boost));
    const t = touch(1, 250, 50);
    fake.emit("touchstart", touchEvent([t], [t]));
    expect(source.poll()).toMatchObject({ boost: true, brake: true });

    fake.emit("blur", {});

    expect(source.poll()).toMatchObject({ boost: false, brake: false });
  });

  it("after release, re-pressing works again (blur doesn't permanently wedge the source)", () => {
    const { fake, source } = setup();
    current = source;
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.boost));
    fake.emit("blur", {});
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.boost));
    expect(source.poll().boost).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// destroy(): listener removal
// ---------------------------------------------------------------------------------------------

describe("destroy()", () => {
  it("removes every listener it added", () => {
    const { fake, source } = setup();
    expect(fake.totalListenerCount()).toBeGreaterThan(0);
    source.destroy();
    expect(fake.totalListenerCount()).toBe(0);
  });

  it("a post-destroy event changes nothing — no stale handler fires", () => {
    const { fake, source } = setup();
    source.destroy();
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.boost));
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.restart));
    expect(source.poll().boost).toBe(false);
    expect(source.drainEvents()).toEqual([]);
  });

  it("repeated create/destroy cycles on the same element never leak or accumulate listeners", () => {
    const fake = new FakeElement();
    const target = fake as unknown as HTMLElement;
    for (let i = 0; i < 25; i++) {
      const src = createInputSource(target);
      expect(fake.listenerCount("keydown")).toBe(1);
      expect(fake.listenerCount("touchstart")).toBe(1);
      src.destroy();
      expect(fake.totalListenerCount()).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Gamepad — what CAN be tested without physical hardware: the mapping and the
// only-poll-when-connected optimization, against a mocked `navigator.getGamepads`.
// ---------------------------------------------------------------------------------------------

describe("gamepad (mocked navigator.getGamepads — no physical hardware available, see results file)", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "navigator", originalDescriptor);
    } else {
      delete (globalThis as { navigator?: unknown }).navigator;
    }
  });

  function stubGamepads(getGamepads: () => unknown[]): void {
    Object.defineProperty(globalThis, "navigator", {
      value: {
        ...((globalThis as { navigator?: object }).navigator ?? {}),
        getGamepads,
      },
      configurable: true,
      writable: true,
    });
  }

  function pad(buttonsPressed: Record<number, boolean>): unknown {
    const buttons = Array.from({ length: 8 }, (_, i) => ({
      pressed: !!buttonsPressed[i],
    }));
    return { connected: true, buttons };
  }

  it("button A (index 0) or right shoulder (index 5) maps to boost, per PhysicsEngine.gd:105", () => {
    stubGamepads(() => [pad({ 0: true })]);
    const { source } = setup();
    current = source;
    expect(source.poll().boost).toBe(true);
    stubGamepads(() => [pad({ 5: true })]);
    expect(source.poll().boost).toBe(true);
  });

  it("button B (index 1) or left shoulder (index 4) maps to brake, per PhysicsEngine.gd:106", () => {
    stubGamepads(() => [pad({ 1: true })]);
    const { source } = setup();
    current = source;
    expect(source.poll().brake).toBe(true);
    stubGamepads(() => [pad({ 4: true })]);
    expect(source.poll().brake).toBe(true);
  });

  it("getGamepads() is called once at construction (probe) and then NOT AGAIN per poll() while nothing is connected — the allocation-avoidance path", () => {
    const spy = vi.fn(() => [] as unknown[]);
    stubGamepads(spy);
    const { source } = setup();
    current = source;
    expect(spy).toHaveBeenCalledTimes(1); // the one-time construction-time probe only
    for (let i = 0; i < 20; i++) source.poll();
    expect(spy).toHaveBeenCalledTimes(1); // still 1 — none of the 20 poll() calls queried it
  });

  it("once a pad IS connected, getGamepads() is called on every poll() (construction probe + one per poll)", () => {
    const connectedSpy = vi.fn(() => [pad({ 0: true })]);
    stubGamepads(connectedSpy);
    const { source } = setup();
    current = source;
    expect(connectedSpy).toHaveBeenCalledTimes(1); // construction-time probe
    for (let i = 0; i < 20; i++) source.poll();
    expect(connectedSpy).toHaveBeenCalledTimes(21); // 1 probe + 20 polls
  });
});

// ---------------------------------------------------------------------------------------------
// poll() cost — reported as a number, not an adjective (docs/GAME.md §6)
// ---------------------------------------------------------------------------------------------

describe("poll() cost", () => {
  it("measures microseconds/call over 100,000 calls with mixed input active", () => {
    const { fake, source } = setup();
    current = source;
    source.attachTouch({
      boost: rect(0, 0, 100, 100),
      brake: rect(200, 0, 300, 100),
    });
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.boost));
    fake.emit("keydown", keyEvent(DEFAULT_CONTROLS.thrustRight));
    const t = touch(1, 250, 50);
    fake.emit("touchstart", touchEvent([t], [t]));

    const N = 100_000;
    // warm up the JIT before timing
    for (let i = 0; i < 1000; i++) source.poll();
    const start = performance.now();
    for (let i = 0; i < N; i++) source.poll();
    const elapsedMs = performance.now() - start;
    const usPerCall = (elapsedMs * 1000) / N;
    // eslint-disable-next-line no-console -- required numeric measurement, see task brief
    console.log(
      `[input.ts] poll() cost: ${usPerCall.toFixed(4)} us/call over ${N} calls (no gamepad)`,
    );
    expect(source.poll().boost).toBe(true); // sanity: still functioning after the tight loop
    expect(usPerCall).toBeLessThan(50); // generous ceiling — this is a report, not a tight gate
  });
});
