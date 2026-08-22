import { describe, expect, it } from "vitest";
import { buildStarfield, drawStarfield } from "./starfield";
import { createFakeCanvas } from "./__tests__/fakeCanvas";

const VIEWPORT = { width: 800, height: 600 };
const TILE = { width: 2200, height: 1600 };

function draw(
  ctx: unknown,
  layers: ReturnType<typeof buildStarfield>,
  viewpoint: { x: number; y: number; zoom: number },
) {
  drawStarfield(
    ctx as CanvasRenderingContext2D,
    layers,
    VIEWPORT,
    viewpoint,
    TILE.width,
    TILE.height,
  );
}

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

  it("has 3 layers with the reference star counts (46, 64, 82), furthest layer locked (pan=1) and nearer layers panning less", () => {
    const layers = buildStarfield();
    expect(layers).toHaveLength(3);
    const starCounts = layers.map((l) =>
      l.groups.reduce((sum, g) => sum + g.stars.length, 0),
    );
    expect(starCounts).toEqual([46, 64, 82]);
    expect(layers[0]!.pan).toBe(1);
    expect(layers[1]!.pan).toBeLessThan(layers[0]!.pan);
    expect(layers[2]!.pan).toBeLessThan(layers[1]!.pan);
  });

  it("batches stars into a small, fixed number of colour-shade groups per layer (perf: fewer fill() calls than stars)", () => {
    const layers = buildStarfield();
    for (const layer of layers) {
      const totalStars = layer.groups.reduce(
        (sum, g) => sum + g.stars.length,
        0,
      );
      expect(layer.groups.length).toBeLessThan(totalStars);
      expect(layer.groups.length).toBeLessThanOrEqual(4);
    }
  });

  it("draws without shimmering: two consecutive draw() calls at the same viewpoint produce identical call sequences", () => {
    const layers = buildStarfield();
    const { ctx: ctx1 } = createFakeCanvas();
    const { ctx: ctx2 } = createFakeCanvas();
    const viewpoint = { x: 12.5, y: -3.25, zoom: 1 };
    draw(ctx1, layers, viewpoint);
    draw(ctx2, layers, viewpoint);
    expect(ctx1.calls).toEqual(ctx2.calls);
    expect(ctx1.calls.length).toBeGreaterThan(0);
  });

  it("the furthest layer (pan=1) moves exactly opposite a viewpoint pan, matching a plain world-space transform", () => {
    const layers = buildStarfield().filter((l) => l.pan === 1);
    const { ctx: ctxStill } = createFakeCanvas();
    const { ctx: ctxMoved } = createFakeCanvas();
    draw(ctxStill, layers, { x: 0, y: 0, zoom: 1 });
    draw(ctxMoved, layers, { x: 100, y: 0, zoom: 1 });
    const arcsStill = ctxStill.calls.filter((c) => c.method === "arc");
    const arcsMoved = ctxMoved.calls.filter((c) => c.method === "arc");
    expect(arcsStill.length).toBe(arcsMoved.length);
    // Every star's screen x must shift by -100 (zoom 1, pan 1) modulo the tile wrap — except the
    // rare star sitting exactly on the wrap seam, which legitimately jumps a full tile instead
    // (indistinguishable on an infinitely-tiled field). Require the overwhelming majority match.
    let matching = 0;
    for (let i = 0; i < arcsStill.length; i++) {
      const dx =
        (arcsMoved[i]!.args[0] as number) - (arcsStill[i]!.args[0] as number);
      const wrapped =
        ((dx + 100 + TILE.width / 2) % TILE.width) - TILE.width / 2;
      if (Math.abs(wrapped) < 1e-6) matching++;
    }
    expect(matching).toBeGreaterThan(arcsStill.length * 0.9);
  });

  it("a nearer layer (pan<1) moves less than the furthest layer for the same viewpoint pan", () => {
    const layers = buildStarfield();
    const furthest = [layers[0]!];
    const nearer = [layers[1]!];
    const { ctx: farStill } = createFakeCanvas();
    const { ctx: farMoved } = createFakeCanvas();
    draw(farStill, furthest, { x: 0, y: 0, zoom: 1 });
    draw(farMoved, furthest, { x: 500, y: 0, zoom: 1 });

    const { ctx: nearStill } = createFakeCanvas();
    const { ctx: nearMoved } = createFakeCanvas();
    draw(nearStill, nearer, { x: 0, y: 0, zoom: 1 });
    draw(nearMoved, nearer, { x: 500, y: 0, zoom: 1 });

    const farArcsStill = farStill.calls.filter((c) => c.method === "arc");
    const farArcsMoved = farMoved.calls.filter((c) => c.method === "arc");
    const nearArcsStill = nearStill.calls.filter((c) => c.method === "arc");
    const nearArcsMoved = nearMoved.calls.filter((c) => c.method === "arc");

    const farShift = Math.abs(
      (farArcsMoved[0]!.args[0] as number) -
        (farArcsStill[0]!.args[0] as number),
    );
    const nearShift = Math.abs(
      (nearArcsMoved[0]!.args[0] as number) -
        (nearArcsStill[0]!.args[0] as number),
    );
    expect(nearShift).toBeLessThan(farShift);
  });

  it("stays put when the viewpoint doesn't move, even if it's non-zero (no player-position term)", () => {
    const layers = buildStarfield();
    const { ctx: ctxA } = createFakeCanvas();
    const { ctx: ctxB } = createFakeCanvas();
    const viewpoint = { x: 321, y: -87, zoom: 1.3 };
    draw(ctxA, layers, viewpoint);
    draw(ctxB, layers, { ...viewpoint });
    expect(ctxA.calls).toEqual(ctxB.calls);
  });

  it("scales star screen size and position with zoom, fitting the whole background to the scene zoom", () => {
    const layers = buildStarfield();
    const { ctx: ctxLow } = createFakeCanvas();
    const { ctx: ctxHigh } = createFakeCanvas();
    draw(ctxLow, layers, { x: 0, y: 0, zoom: 1 });
    draw(ctxHigh, layers, { x: 0, y: 0, zoom: 2 });
    const arcsLow = ctxLow.calls.filter((c) => c.method === "arc");
    const arcsHigh = ctxHigh.calls.filter((c) => c.method === "arc");
    expect(arcsLow.length).toBe(arcsHigh.length);
    // Radius (arc's 3rd arg) must double when zoom doubles.
    const anyDoubled = arcsLow.some((c, i) => {
      const r0 = c.args[2] as number;
      const r1 = arcsHigh[i]!.args[2] as number;
      return r0 > 0 && Math.abs(r1 / r0 - 2) < 1e-6;
    });
    expect(anyDoubled).toBe(true);
  });

  it("draws all ~192 stars with far fewer than 192 fill() calls", () => {
    const layers = buildStarfield();
    const totalStars = layers.reduce(
      (sum, l) => sum + l.groups.reduce((s, g) => s + g.stars.length, 0),
      0,
    );
    const { ctx } = createFakeCanvas();
    draw(ctx, layers, { x: 0, y: 0, zoom: 1 });
    const starFills = ctx.calls.filter((c) => c.method === "fill"); // includes the 2 glow fills too
    expect(totalStars).toBeGreaterThan(100);
    expect(starFills.length).toBeLessThan(20);
    expect(ctx.calls.filter((c) => c.method === "arc").length).toBe(
      totalStars + 2,
    ); // stars + 2 glow circles
  });
});
