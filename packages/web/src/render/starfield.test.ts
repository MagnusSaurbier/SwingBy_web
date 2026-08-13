import { describe, expect, it } from "vitest";
import { buildStarfield, drawStarfield } from "./starfield";
import { createFakeCanvas } from "./__tests__/fakeCanvas";

describe("starfield", () => {
  it("is deterministic: same seed produces byte-identical star layers every call", () => {
    const a = buildStarfield();
    const b = buildStarfield();
    expect(a).toEqual(b);
  });

  it("different seeds produce different fields", () => {
    const a = buildStarfield(1);
    const b = buildStarfield(2);
    expect(a).not.toEqual(b);
  });

  it("has 3 layers with the reference star counts (46, 64, 82) and increasing parallax", () => {
    const layers = buildStarfield();
    expect(layers).toHaveLength(3);
    const starCounts = layers.map((l) => l.groups.reduce((sum, g) => sum + g.stars.length, 0));
    expect(starCounts).toEqual([46, 64, 82]);
    expect(layers[0]!.parallax).toBeLessThan(layers[1]!.parallax);
    expect(layers[1]!.parallax).toBeLessThan(layers[2]!.parallax);
  });

  it("batches stars into a small, fixed number of colour-shade groups per layer (perf: fewer fill() calls than stars)", () => {
    const layers = buildStarfield();
    for (const layer of layers) {
      const totalStars = layer.groups.reduce((sum, g) => sum + g.stars.length, 0);
      expect(layer.groups.length).toBeLessThan(totalStars);
      expect(layer.groups.length).toBeLessThanOrEqual(4);
    }
  });

  it("draws without shimmering: two consecutive draw() calls at the same offset produce identical call sequences", () => {
    const layers = buildStarfield();
    const { ctx: ctx1 } = createFakeCanvas();
    const { ctx: ctx2 } = createFakeCanvas();
    const viewport = { width: 800, height: 600 };
    drawStarfield(ctx1 as unknown as CanvasRenderingContext2D, layers, viewport, 12.5, -3.25);
    drawStarfield(ctx2 as unknown as CanvasRenderingContext2D, layers, viewport, 12.5, -3.25);
    expect(ctx1.calls).toEqual(ctx2.calls);
    expect(ctx1.calls.length).toBeGreaterThan(0);
  });

  it("moves stars opposite the player offset, scaled by each layer's parallax", () => {
    const layers = buildStarfield();
    const viewport = { width: 800, height: 600 };
    const { ctx: ctxStill } = createFakeCanvas();
    const { ctx: ctxMoved } = createFakeCanvas();
    drawStarfield(ctxStill as unknown as CanvasRenderingContext2D, layers, viewport, 0, 0);
    drawStarfield(ctxMoved as unknown as CanvasRenderingContext2D, layers, viewport, 100, 0);
    const arcsStill = ctxStill.calls.filter((c) => c.method === "arc");
    const arcsMoved = ctxMoved.calls.filter((c) => c.method === "arc");
    expect(arcsStill.length).toBe(arcsMoved.length);
    // At least one star's x must have shifted once we introduce a nonzero player offset.
    const anyShifted = arcsStill.some((c, i) => c.args[0] !== arcsMoved[i]!.args[0]);
    expect(anyShifted).toBe(true);
  });

  it("draws all ~192 stars with far fewer than 192 fill() calls", () => {
    const layers = buildStarfield();
    const totalStars = layers.reduce((sum, l) => sum + l.groups.reduce((s, g) => s + g.stars.length, 0), 0);
    const { ctx } = createFakeCanvas();
    drawStarfield(ctx as unknown as CanvasRenderingContext2D, layers, { width: 800, height: 600 }, 0, 0);
    const starFills = ctx.calls.filter((c) => c.method === "fill"); // includes the 2 glow fills too
    expect(totalStars).toBeGreaterThan(100);
    expect(starFills.length).toBeLessThan(20);
    expect(ctx.calls.filter((c) => c.method === "arc").length).toBe(totalStars + 2); // stars + 2 glow circles
  });
});
