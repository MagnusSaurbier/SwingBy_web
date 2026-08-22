import { describe, expect, it } from "vitest";
import {
  buildStarfield,
  collectVisibleStars,
  drawStarfield,
  projectBackgroundPoint,
} from "./starfield";
import { createFakeCanvas } from "./__tests__/fakeCanvas";

const VIEWPORT = { width: 800, height: 600 };

function arcCount(calls: { method: string }[]): number {
  return calls.filter((c) => c.method === "arc").length;
}

describe("starfield config", () => {
  it("is deterministic: same seed produces byte-identical layer configs every call", () => {
    const a = buildStarfield();
    const b = buildStarfield();
    expect(a).toEqual(b);
  });

  it("different seeds produce different layer configs", () => {
    const a = buildStarfield(1);
    const b = buildStarfield(2);
    expect(a).not.toEqual(b);
  });

  it("has 3 layers, furthest locked (pan=1) and nearer layers panning less", () => {
    const layers = buildStarfield();
    expect(layers).toHaveLength(3);
    expect(layers[0]!.pan).toBe(1);
    expect(layers[1]!.pan).toBeLessThan(layers[0]!.pan);
    expect(layers[2]!.pan).toBeLessThan(layers[1]!.pan);
  });
});

describe("projectBackgroundPoint (sign convention)", () => {
  it("moves WITH the viewpoint pan direction (not opposite, unlike a plain world object)", () => {
    const world = { x: 0, y: 0 };
    const a = projectBackgroundPoint(
      { x: 0, y: 0 },
      world.x,
      world.y,
      1,
      1,
      VIEWPORT,
    );
    const b = projectBackgroundPoint(
      { x: 100, y: 0 },
      world.x,
      world.y,
      1,
      1,
      VIEWPORT,
    );
    // A plain world object would shift by -100 here (halfW + (world - viewpoint)*zoom); the
    // background is intentionally reversed, so it shifts by +100 instead.
    expect(b.x - a.x).toBeCloseTo(100, 9);
    expect(b.y - a.y).toBeCloseTo(0, 9);
  });

  it("scales with pan: a smaller pan fraction moves less for the same viewpoint delta", () => {
    const world = { x: 0, y: 0 };
    const lockedA = projectBackgroundPoint(
      { x: 0, y: 0 },
      world.x,
      world.y,
      1,
      1,
      VIEWPORT,
    );
    const lockedB = projectBackgroundPoint(
      { x: 100, y: 0 },
      world.x,
      world.y,
      1,
      1,
      VIEWPORT,
    );
    const laggingA = projectBackgroundPoint(
      { x: 0, y: 0 },
      world.x,
      world.y,
      0.3,
      1,
      VIEWPORT,
    );
    const laggingB = projectBackgroundPoint(
      { x: 100, y: 0 },
      world.x,
      world.y,
      0.3,
      1,
      VIEWPORT,
    );
    const lockedShift = lockedB.x - lockedA.x;
    const laggingShift = laggingB.x - laggingA.x;
    expect(laggingShift).toBeCloseTo(lockedShift * 0.3, 9);
    expect(Math.abs(laggingShift)).toBeLessThan(Math.abs(lockedShift));
  });

  it("scales with zoom", () => {
    const p1 = projectBackgroundPoint({ x: 10, y: 0 }, 0, 0, 1, 1, VIEWPORT);
    const p2 = projectBackgroundPoint({ x: 10, y: 0 }, 0, 0, 1, 2, VIEWPORT);
    expect(p2.x - VIEWPORT.width / 2).toBeCloseTo(
      (p1.x - VIEWPORT.width / 2) * 2,
      9,
    );
  });
});

describe("drawStarfield", () => {
  it("draws without shimmering: two consecutive draw() calls at the same viewpoint produce identical call sequences", () => {
    const layers = buildStarfield();
    const { ctx: ctx1 } = createFakeCanvas();
    const { ctx: ctx2 } = createFakeCanvas();
    const viewpoint = { x: 12.5, y: -3.25, zoom: 1 };
    drawStarfield(
      ctx1 as unknown as CanvasRenderingContext2D,
      layers,
      VIEWPORT,
      viewpoint,
    );
    drawStarfield(
      ctx2 as unknown as CanvasRenderingContext2D,
      layers,
      VIEWPORT,
      viewpoint,
    );
    expect(ctx1.calls).toEqual(ctx2.calls);
    expect(ctx1.calls.length).toBeGreaterThan(0);
  });

  it("stays put when the viewpoint doesn't move, even if it's non-zero (no player-position term)", () => {
    const layers = buildStarfield();
    const { ctx: ctxA } = createFakeCanvas();
    const { ctx: ctxB } = createFakeCanvas();
    const viewpoint = { x: 321, y: -87, zoom: 1.3 };
    drawStarfield(
      ctxA as unknown as CanvasRenderingContext2D,
      layers,
      VIEWPORT,
      viewpoint,
    );
    drawStarfield(
      ctxB as unknown as CanvasRenderingContext2D,
      layers,
      VIEWPORT,
      { ...viewpoint },
    );
    expect(ctxA.calls).toEqual(ctxB.calls);
  });

  it("covers the sky arbitrarily far from the origin — no 'edge of the world' gap", () => {
    const layers = buildStarfield();
    const { ctx: near } = createFakeCanvas();
    const { ctx: far } = createFakeCanvas();
    drawStarfield(
      near as unknown as CanvasRenderingContext2D,
      layers,
      VIEWPORT,
      {
        x: 0,
        y: 0,
        zoom: 1,
      },
    );
    drawStarfield(
      far as unknown as CanvasRenderingContext2D,
      layers,
      VIEWPORT,
      {
        x: 5_000_000,
        y: -3_000_000,
        zoom: 1,
      },
    );
    expect(arcCount(near.calls)).toBeGreaterThan(0);
    expect(arcCount(far.calls)).toBeGreaterThan(0);
    // Roughly comparable counts far from the origin as near it — nothing thins out or runs out.
    const ratio = arcCount(far.calls) / arcCount(near.calls);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });

  it("keeps star count (and therefore per-frame work) roughly constant across extreme zoom levels", () => {
    const layers = buildStarfield();
    const counts: number[] = [];
    for (const zoom of [0.0001, 0.01, 1, 100, 10000]) {
      const { ctx } = createFakeCanvas();
      drawStarfield(
        ctx as unknown as CanvasRenderingContext2D,
        layers,
        VIEWPORT,
        {
          x: 0,
          y: 0,
          zoom,
        },
      );
      counts.push(arcCount(ctx.calls));
    }
    for (const c of counts) {
      expect(c).toBeGreaterThan(0);
    }
    // Zoom spans 8 orders of magnitude (0.0001 to 10000); a naive fixed-world-density field would
    // show a ~1/zoom^2 star count and blow up by ~16 orders of magnitude across that range. The
    // actual spread should be small — at most a couple of orders of magnitude, from octave
    // snapping wobble, not from an unbounded density-vs-zoom relationship.
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    expect(max / min).toBeLessThan(50);
  });

  it("identity and growth persist across a zoom change: a star visible at low zoom is still there, and bigger, once zoomed in on it", () => {
    const layers = buildStarfield();
    const zoomedOut = collectVisibleStars(layers, VIEWPORT, {
      x: 0,
      y: 0,
      zoom: 0.05,
    });
    expect(zoomedOut.length).toBeGreaterThan(0);

    // Re-center the viewpoint exactly on a handful of those stars (dead center of screen) and
    // zoom in hard — each one, at its own fixed world position, must still be found, with a
    // LARGER on-screen radius (never silently replaced by an unrelated star).
    for (const star of zoomedOut.slice(0, 10)) {
      const viewpoint = { x: star.worldX, y: star.worldY };
      const zoomedIn = collectVisibleStars(layers, VIEWPORT, {
        ...viewpoint,
        zoom: 50,
      });
      const match = zoomedIn.find(
        (s) =>
          Math.abs(s.worldX - star.worldX) < 1e-6 &&
          Math.abs(s.worldY - star.worldY) < 1e-6,
      );
      expect(match).toBeDefined();
      expect(match!.r).toBeGreaterThan(star.r);
    }
  });

  it("no single-frame population swap: adjacent small zoom steps change only a small fraction of stars, not the whole set", () => {
    const layers = buildStarfield();
    const key = (s: { worldX: number; worldY: number }) =>
      `${s.worldX.toFixed(3)},${s.worldY.toFixed(3)}`;
    const a = collectVisibleStars(layers, VIEWPORT, { x: 0, y: 0, zoom: 1 });
    const b = collectVisibleStars(layers, VIEWPORT, {
      x: 0,
      y: 0,
      zoom: 1.02,
    });
    const aKeys = new Set(a.map(key));
    const shared = b.filter((s) => aKeys.has(key(s))).length;
    // Most stars present at one zoom are still present at a 2%-higher zoom — nothing near a
    // wholesale octave swap (which would share close to none).
    expect(shared / Math.min(a.length, b.length)).toBeGreaterThan(0.7);
  });

  it("size is independent of pan tier: a near (low-pan) tier and a far (pan=1) tier draw from the same size range", () => {
    const layers = buildStarfield();
    const far = layers.find((l) => l.pan === 1)!;
    const near = layers.reduce((a, b) => (a.pan < b.pan ? a : b));
    const viewpoint = { x: 1000, y: -500, zoom: 1 };
    const farStars = collectVisibleStars([far], VIEWPORT, viewpoint);
    const nearStars = collectVisibleStars([near], VIEWPORT, viewpoint);
    expect(farStars.length).toBeGreaterThan(0);
    expect(nearStars.length).toBeGreaterThan(0);
    const farSizes = farStars.map((s) => s.r).sort((x, y) => x - y);
    const nearSizes = nearStars.map((s) => s.r).sort((x, y) => x - y);
    // Overlapping size ranges (not "far is always tiny, near is always huge" or vice versa).
    const farMax = farSizes[farSizes.length - 1]!;
    const nearMin = nearSizes[0]!;
    const farMin = farSizes[0]!;
    const nearMax = nearSizes[nearSizes.length - 1]!;
    expect(farMax).toBeGreaterThan(nearMin);
    expect(nearMax).toBeGreaterThan(farMin);
  });

  it("draws with far fewer fill() calls than stars (shade-batched)", () => {
    const layers = buildStarfield();
    const { ctx } = createFakeCanvas();
    drawStarfield(
      ctx as unknown as CanvasRenderingContext2D,
      layers,
      VIEWPORT,
      {
        x: 0,
        y: 0,
        zoom: 1,
      },
    );
    const starFills = ctx.calls.filter((c) => c.method === "fill"); // includes the 2 glow fills too
    const stars = arcCount(ctx.calls) - 2; // minus the 2 glow arcs
    expect(stars).toBeGreaterThan(20);
    expect(starFills.length).toBeLessThan(20);
  });
});
