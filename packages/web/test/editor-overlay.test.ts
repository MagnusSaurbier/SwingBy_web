/**
 * T-11 DRAFT — overlay.ts: button geometry, hit-testing, and the paint pass. Uses the REAL
 * `createRenderer` (T-04) against a fake canvas for `worldToScreen`, never a reimplementation.
 */
import { describe, expect, it } from "vitest";
import type { Body } from "@swingby/core/types";
import { createRenderer } from "../src/render/index.js";
import { makeFakeCanvas } from "../src/editor/__tests__/fakes.js";
import {
  buttonNamesFor,
  buttonPositions,
  hitTestButtons,
  hoverRadiusPx,
  paintEditorOverlay,
  resizeRestDirection,
  type EditorOverlay,
} from "../src/editor/overlay.js";

function makeBody(overrides: Partial<Body> = {}): Body {
  return {
    type: "planet",
    x: 500,
    y: 400,
    xVel: 0,
    yVel: 0,
    xAcc: 0,
    yAcc: 0,
    gravity: 100,
    size: 12,
    visible: true,
    anchored: false,
    angle: 0,
    turnSpeed: 0,
    isBoosting: false,
    isBraking: false,
    boostType: 0,
    ...overrides,
  };
}

describe("buttonNamesFor", () => {
  it("suns have no velocity handle; planets and players do", () => {
    expect(buttonNamesFor("sun")).not.toContain("velocity");
    expect(buttonNamesFor("planet")).toContain("velocity");
    expect(buttonNamesFor("player")).toContain("velocity");
  });
});

describe("buttonPositions + hitTestButtons", () => {
  const { canvas } = makeFakeCanvas(960, 600);
  const renderer = createRenderer(canvas);
  renderer.resize(960, 600, 1);
  const camera = { x: 500, y: 400, zoom: 1 };

  it("places the move button exactly on the body's screen position", () => {
    const body = makeBody();
    const buttons = buttonPositions(body, camera, renderer, null);
    const move = buttons.find((b) => b.name === "move")!;
    const center = renderer.worldToScreen({ x: body.x, y: body.y }, camera);
    expect(move.x).toBeCloseTo(center.x, 6);
    expect(move.y).toBeCloseTo(center.y, 6);
  });

  it("hitTestButtons finds the nearest button within its radius, null otherwise", () => {
    const body = makeBody();
    const buttons = buttonPositions(body, camera, renderer, null);
    const move = buttons.find((b) => b.name === "move")!;
    expect(hitTestButtons(buttons, { x: move.x + 2, y: move.y - 1 })).toBe(
      "move",
    );
    expect(
      hitTestButtons(buttons, { x: move.x + 500, y: move.y + 500 }),
    ).toBeNull();
  });
});

describe("hoverRadiusPx", () => {
  it("grows with body size and zoom, never below the minimum tappable target", () => {
    const small = hoverRadiusPx({ size: 4 }, 0.1);
    const large = hoverRadiusPx({ size: 40 }, 3);
    expect(small).toBeGreaterThanOrEqual(24);
    expect(large).toBeGreaterThan(small);
  });
});

describe("paintEditorOverlay", () => {
  it("draws without throwing for a representative overlay state, using only the documented context surface", () => {
    const { canvas, ctx } = makeFakeCanvas(960, 600);
    const renderer = createRenderer(canvas);
    renderer.resize(960, 600, 1);
    const camera = { x: 500, y: 400, zoom: 1 };
    const bodies: Body[] = [
      makeBody({ type: "sun", gravity: 1000 }),
      makeBody({ xVel: 0.5, yVel: -0.2 }),
    ];
    const overlay: EditorOverlay = {
      tool: "select",
      placeType: null,
      selectedIndex: 1,
      hoverIndex: 1,
      phantom: null,
      dragging: null,
      requiresReset: false,
      buttons: buttonPositions(bodies[1]!, camera, renderer, "move"),
      goalIndex: 1,
    };
    expect(() =>
      paintEditorOverlay(ctx, overlay, bodies, camera, renderer),
    ).not.toThrow();
    expect(ctx.calls).toContain("arc");
  });

  it("draws the placement ghost when phantom is set", () => {
    const { canvas, ctx } = makeFakeCanvas(960, 600);
    const renderer = createRenderer(canvas);
    renderer.resize(960, 600, 1);
    const camera = { x: 0, y: 0, zoom: 1 };
    const overlay: EditorOverlay = {
      tool: "place",
      placeType: "planet",
      selectedIndex: -1,
      hoverIndex: -1,
      phantom: { type: "planet", x: 10, y: 10 },
      dragging: null,
      requiresReset: false,
      buttons: [],
      goalIndex: 0,
    };
    const before = ctx.calls.length;
    paintEditorOverlay(ctx, overlay, [], camera, renderer);
    expect(ctx.calls.length).toBeGreaterThan(before);
  });
});

// ---------------------------------------------------------------------------
// Live-drag override for the resize handle. Mirrors the `liveVelocityEnd` override that the
// velocity handle has always had — see `buttonPositions`'s doc comment in overlay.ts for why the
// resize half of the original "fixed compass arrangement" decision was overridden.
// ---------------------------------------------------------------------------

describe("buttonPositions — resize live-drag override", () => {
  const { canvas } = makeFakeCanvas(960, 600);
  const renderer = createRenderer(canvas);
  renderer.resize(960, 600, 1);
  const camera = { x: 500, y: 400, zoom: 1 };

  it("puts the resize button exactly at the live drag point", () => {
    const body = makeBody();
    const live = { x: 123.5, y: 456.25 };
    const resize = buttonPositions(
      body,
      camera,
      renderer,
      null,
      null,
      live,
    ).find((b) => b.name === "resize")!;
    expect(resize.x).toBeCloseTo(live.x, 6);
    expect(resize.y).toBeCloseTo(live.y, 6);
  });

  it("leaves move, velocity and delete untouched while resize is live-dragged", () => {
    const body = makeBody();
    const atrest = buttonPositions(body, camera, renderer, null);
    const dragged = buttonPositions(body, camera, renderer, null, null, {
      x: 123.5,
      y: 456.25,
    });
    for (const name of ["move", "velocity", "delete"] as const) {
      const a = atrest.find((b) => b.name === name)!;
      const d = dragged.find((b) => b.name === name)!;
      expect(d.x).toBeCloseTo(a.x, 6);
      expect(d.y).toBeCloseTo(a.y, 6);
    }
  });

  it("rests at the fixed compass position when no live drag point is given", () => {
    const body = makeBody();
    const center = renderer.worldToScreen({ x: body.x, y: body.y }, camera);
    for (const live of [undefined, null]) {
      const resize = buttonPositions(
        body,
        camera,
        renderer,
        null,
        null,
        live,
      ).find((b) => b.name === "resize")!;
      expect(resize.x).toBeLessThan(center.x);
      expect(resize.y).toBeCloseTo(center.y, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// Resting direction for the resize handle (owner's polar rule). Approved and landed ahead of the
// rule that will consume it — see notes/feat-editor-canvas-interaction/PLAN-INCREMENT-3.md; the
// DISTANCE half is still with the owner, so `buttonPositions` does not call this yet.
// ---------------------------------------------------------------------------

describe("resizeRestDirection", () => {
  const camera = { x: 500, y: 400, zoom: 1 };

  it("points from the body toward the camera centre, normalised", () => {
    // Body left of and below the camera centre -> unit vector up and to the right.
    const d = resizeRestDirection({ x: 200, y: 800 }, camera);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 12);
    expect(d.x).toBeCloseTo(300 / Math.hypot(300, -400), 12);
    expect(d.y).toBeCloseTo(-400 / Math.hypot(300, -400), 12);
  });

  it("is a unit vector from every direction, and flips across the centre", () => {
    const left = resizeRestDirection({ x: 100, y: 400 }, camera);
    const right = resizeRestDirection({ x: 900, y: 400 }, camera);
    expect(left.x).toBeCloseTo(1, 12);
    expect(right.x).toBeCloseTo(-1, 12);
    for (const d of [left, right])
      expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 12);
  });

  it("falls back to straight left when the body sits exactly on the camera centre", () => {
    const d = resizeRestDirection({ x: camera.x, y: camera.y }, camera);
    expect(d).toEqual({ x: -1, y: 0 });
  });

  it("REFUSES to produce NaN or Infinity for any degenerate input", () => {
    const cases = [
      { x: camera.x, y: camera.y },
      { x: camera.x + Number.MIN_VALUE, y: camera.y },
      { x: camera.x, y: camera.y - Number.MIN_VALUE },
    ];
    for (const body of cases) {
      const d = resizeRestDirection(body, camera);
      expect(Number.isFinite(d.x)).toBe(true);
      expect(Number.isFinite(d.y)).toBe(true);
      expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 12);
    }
  });
});
