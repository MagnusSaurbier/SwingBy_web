import { describe, expect, it, vi } from "vitest";
import type { RenderFrame } from "./index";
import { createRenderer } from "./index";
import { createFakeCanvas } from "./__tests__/fakeCanvas";
import { makeBody, makeFixtureWorld } from "./__tests__/fixtures";

function baseFrame(overrides: Partial<RenderFrame> = {}): RenderFrame {
  return {
    world: makeFixtureWorld(),
    camera: { x: 1300, y: 900, zoom: 1 },
    trail: [],
    prediction: null,
    forceVector: null,
    boundsWarning: 0,
    flash: 0,
    showTrail: false,
    ...overrides,
  };
}

describe("createRenderer", () => {
  it("resize() sets the canvas backing store to cssSize*dpr and CSS style to cssSize", () => {
    const { canvas } = createFakeCanvas();
    const renderer = createRenderer(canvas);
    renderer.resize(400, 300, 2);
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(canvas.style.width).toBe("400px");
    expect(canvas.style.height).toBe("300px");
  });

  it("resize() applies the dpr transform exactly once via setTransform, not by scaling in draw()", () => {
    const { canvas, ctx } = createFakeCanvas();
    const renderer = createRenderer(canvas);
    renderer.resize(400, 300, 2);
    const setTransformCalls = ctx.calls.filter((c) => c.method === "setTransform");
    expect(setTransformCalls).toEqual([{ method: "setTransform", args: [2, 0, 0, 2, 0, 0] }]);

    ctx.calls = [];
    renderer.draw(baseFrame());
    // draw() must never re-touch the canvas-wide transform for dpr — that's resize()'s job alone.
    // (ctx.scale() DOES legitimately appear inside save()/restore() blocks for per-body sprite
    // scaling — that's unrelated to dpr and is not what this asserts.)
    expect(ctx.calls.some((c) => c.method === "setTransform")).toBe(false);
  });

  it("worldToScreen/screenToWorld reflect the viewport set by resize() and stay exact inverses", () => {
    const { canvas } = createFakeCanvas();
    const renderer = createRenderer(canvas);
    renderer.resize(1000, 800, 1);
    const camera = { x: 500, y: 500, zoom: 2 };
    const centerScreen = renderer.worldToScreen({ x: 500, y: 500 }, camera);
    expect(centerScreen).toEqual({ x: 500, y: 400 }); // viewport center

    const p = { x: 123.456, y: -789.012 };
    const s = renderer.worldToScreen(p, camera);
    const back = renderer.screenToWorld(s, camera);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  it("draws an invisible sun as genuinely absent — toggling visible removes exactly its 3 arcs", () => {
    const { canvas: canvasVisible, ctx: ctxVisible } = createFakeCanvas();
    const rendererVisible = createRenderer(canvasVisible);
    rendererVisible.resize(800, 600, 1);
    const worldVisible = makeFixtureWorld();
    worldVisible.bodies[1] = { ...worldVisible.bodies[1]!, visible: true }; // the hidden sun, forced visible
    rendererVisible.draw(baseFrame({ world: worldVisible }));

    const { canvas: canvasHidden, ctx: ctxHidden } = createFakeCanvas();
    const rendererHidden = createRenderer(canvasHidden);
    rendererHidden.resize(800, 600, 1);
    const worldHidden = makeFixtureWorld(); // bodies[1].visible === false by fixture default
    rendererHidden.draw(baseFrame({ world: worldHidden }));

    const arcsVisible = ctxVisible.calls.filter((c) => c.method === "arc").length;
    const arcsHidden = ctxHidden.calls.filter((c) => c.method === "arc").length;
    expect(arcsVisible - arcsHidden).toBe(3); // exactly the invisible sun's halo+mid+core
  });

  it("draws in reference order: background before bodies before bounds-warning before reset-flash", () => {
    const { canvas, ctx } = createFakeCanvas();
    const renderer = createRenderer(canvas);
    renderer.resize(800, 600, 1);
    renderer.draw(baseFrame({ boundsWarning: 0.8, flash: 0.5 }));

    const firstFillRectIdx = ctx.calls.findIndex((c) => c.method === "fillRect"); // starfield background
    const firstStrokeRectIdx = ctx.calls.findIndex((c) => c.method === "strokeRect"); // bounds warning
    const lastFillRectIdx = ctx.calls.map((c) => c.method).lastIndexOf("fillRect"); // reset flash is last fillRect

    expect(firstFillRectIdx).toBeGreaterThanOrEqual(0);
    expect(firstStrokeRectIdx).toBeGreaterThan(firstFillRectIdx);
    expect(lastFillRectIdx).toBeGreaterThan(firstStrokeRectIdx);
  });

  it("never reads frame.editorOverlay — an arbitrary opaque value changes nothing", () => {
    // Goal-ring / bounds-warning pulse reads a wall clock (see overlays.ts's doc comment) — pin
    // it so the only possible source of a diff between these two draws is editorOverlay itself.
    const nowSpy = vi.spyOn(performance, "now").mockReturnValue(12345);
    try {
      const { canvas: canvasA, ctx: ctxA } = createFakeCanvas();
      const rA = createRenderer(canvasA);
      rA.resize(800, 600, 1);
      rA.draw(baseFrame());

      const { canvas: canvasB, ctx: ctxB } = createFakeCanvas();
      const rB = createRenderer(canvasB);
      rB.resize(800, 600, 1);
      rB.draw(baseFrame({ editorOverlay: { anything: "goes", nested: [1, 2, { x: () => {} }] } }));

      expect(ctxA.calls).toEqual(ctxB.calls);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("draws the force vector only when present and only relative to the player", () => {
    const { canvas, ctx } = createFakeCanvas();
    const renderer = createRenderer(canvas);
    renderer.resize(800, 600, 1);
    renderer.draw(baseFrame({ forceVector: null }));
    const callsWithoutForce = ctx.calls.length;

    ctx.calls = [];
    renderer.draw(baseFrame({ forceVector: { x: 0.01, y: 0 } }));
    const callsWithForce = ctx.calls.length;

    expect(callsWithForce).toBeGreaterThan(callsWithoutForce);
  });

  it("tolerates a world that mutates between draw() calls without throwing", () => {
    const { canvas } = createFakeCanvas();
    const renderer = createRenderer(canvas);
    renderer.resize(800, 600, 1);
    const world = makeFixtureWorld();
    const frame = baseFrame({ world });
    expect(() => renderer.draw(frame)).not.toThrow();
    world.bodies.push(makeBody({ type: "planet", x: 50, y: 50 }));
    world.bodies[0]!.x = 99999;
    expect(() => renderer.draw(frame)).not.toThrow();
  });

  it("throws a clear error if the canvas has no 2D context available", () => {
    const canvas = { width: 100, height: 100, style: {}, getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => createRenderer(canvas)).toThrow();
  });
});
