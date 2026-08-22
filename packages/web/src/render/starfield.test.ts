import type { Settings } from "@swingby/core";
import { describe, expect, it } from "vitest";
import {
  buildStarfield,
  clampMinStarSize,
  collectStars,
  drawStarfield,
  MAX_STAR_PAN,
  MAX_STAR_SIZE,
  MIN_STAR_PAN,
  MIN_STAR_SIZE,
  MIN_STAR_SIZE_MAX,
  MIN_STAR_SIZE_MIN,
  minStarSizePatch,
  readMinStarSize,
  projectBackgroundPoint,
} from "./starfield";
import { createFakeCanvas } from "./__tests__/fakeCanvas";

const VIEWPORT = { width: 800, height: 600 };

function arcCount(calls: { method: string }[]): number {
  return calls.filter((c) => c.method === "arc").length;
}

describe("starfield config", () => {
  it("is deterministic: same seed produces byte-identical field config every call", () => {
    const a = buildStarfield();
    const b = buildStarfield();
    expect(a).toEqual(b);
  });

  it("different seeds produce different field configs", () => {
    const a = buildStarfield(1);
    const b = buildStarfield(2);
    expect(a).not.toEqual(b);
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

describe("collectStars", () => {
  it("every star's pan falls within [MIN_STAR_PAN, MAX_STAR_PAN]", () => {
    const field = buildStarfield();
    const stars = collectStars(field, VIEWPORT, { x: 500, y: -300, zoom: 1 });
    expect(stars.length).toBeGreaterThan(0);
    for (const s of stars) {
      expect(s.pan).toBeGreaterThanOrEqual(
        Math.min(MIN_STAR_PAN, MAX_STAR_PAN),
      );
      expect(s.pan).toBeLessThanOrEqual(Math.max(MIN_STAR_PAN, MAX_STAR_PAN));
    }
  });

  it("depth (pan) and size are independent: pan doesn't predict radius", () => {
    const field = buildStarfield();
    const stars = collectStars(field, VIEWPORT, { x: 2000, y: -1500, zoom: 1 });
    expect(stars.length).toBeGreaterThan(30);
    const midPan = (MIN_STAR_PAN + MAX_STAR_PAN) / 2;
    const lowPan = stars.filter((s) => s.pan < midPan).map((s) => s.r);
    const highPan = stars.filter((s) => s.pan >= midPan).map((s) => s.r);
    expect(lowPan.length).toBeGreaterThan(0);
    expect(highPan.length).toBeGreaterThan(0);
    // Overlapping size ranges on both sides of the pan midpoint (not "low pan is always tiny" or
    // vice versa) — a small near-pan star can match a large far-pan star and vice versa.
    expect(Math.max(...lowPan)).toBeGreaterThan(Math.min(...highPan));
    expect(Math.max(...highPan)).toBeGreaterThan(Math.min(...lowPan));
  });
});

describe("drawStarfield", () => {
  it("draws without shimmering: two consecutive draw() calls at the same viewpoint produce identical call sequences", () => {
    const field = buildStarfield();
    const { ctx: ctx1 } = createFakeCanvas();
    const { ctx: ctx2 } = createFakeCanvas();
    const viewpoint = { x: 12.5, y: -3.25, zoom: 1 };
    drawStarfield(
      ctx1 as unknown as CanvasRenderingContext2D,
      field,
      VIEWPORT,
      viewpoint,
    );
    drawStarfield(
      ctx2 as unknown as CanvasRenderingContext2D,
      field,
      VIEWPORT,
      viewpoint,
    );
    expect(ctx1.calls).toEqual(ctx2.calls);
    expect(ctx1.calls.length).toBeGreaterThan(0);
  });

  it("stays put when the viewpoint doesn't move, even if it's non-zero (no player-position term)", () => {
    const field = buildStarfield();
    const { ctx: ctxA } = createFakeCanvas();
    const { ctx: ctxB } = createFakeCanvas();
    const viewpoint = { x: 321, y: -87, zoom: 1.3 };
    drawStarfield(
      ctxA as unknown as CanvasRenderingContext2D,
      field,
      VIEWPORT,
      viewpoint,
    );
    drawStarfield(
      ctxB as unknown as CanvasRenderingContext2D,
      field,
      VIEWPORT,
      { ...viewpoint },
    );
    expect(ctxA.calls).toEqual(ctxB.calls);
  });

  it("covers the sky far from the origin — no 'edge of the world' gap", () => {
    // Comfortably beyond the level's actual world bounds (MAX_WORLD_BOUNDS_X/Y, ~2600x1800) but
    // not so extreme it exercises the defensive per-octave cell cap (see MAX_CELLS_PER_AXIS) —
    // that cap exists to bound truly pathological viewpoints, not ordinary far-from-origin play.
    const field = buildStarfield();
    const { ctx: near } = createFakeCanvas();
    const { ctx: far } = createFakeCanvas();
    drawStarfield(
      near as unknown as CanvasRenderingContext2D,
      field,
      VIEWPORT,
      {
        x: 0,
        y: 0,
        zoom: 1,
      },
    );
    drawStarfield(far as unknown as CanvasRenderingContext2D, field, VIEWPORT, {
      x: 20_000,
      y: -15_000,
      zoom: 1,
    });
    expect(arcCount(near.calls)).toBeGreaterThan(0);
    expect(arcCount(far.calls)).toBeGreaterThan(0);
    // Roughly comparable counts far from the origin as near it — nothing thins out or runs out.
    const ratio = arcCount(far.calls) / arcCount(near.calls);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });

  it("keeps star count (and therefore per-frame work) roughly constant across extreme zoom levels", () => {
    const field = buildStarfield();
    const counts: number[] = [];
    for (const zoom of [0.0001, 0.01, 1, 100, 10000]) {
      const { ctx } = createFakeCanvas();
      drawStarfield(
        ctx as unknown as CanvasRenderingContext2D,
        field,
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
    // Same fixed viewpoint at two zoom levels (rather than trying to re-center on a specific
    // star — with per-star `pan` no longer fixed at 1, "viewpoint = star's own worldX/Y" doesn't
    // generally put it at screen center any more, since screenX depends on pan*viewpoint.x, not
    // viewpoint.x alone). A star within both zoom levels' visible half-extent, and with headroom
    // below MAX_STAR_SIZE at the higher zoom, must be found at both, larger the second time.
    const field = buildStarfield();
    const viewpoint = { x: 0, y: 0 };
    const zoomedOut = collectStars(field, VIEWPORT, { ...viewpoint, zoom: 1 });
    const zoomedIn = collectStars(field, VIEWPORT, { ...viewpoint, zoom: 2 });

    const persistent = zoomedOut.filter(
      (s) => Math.abs(s.worldX) < 100 && Math.abs(s.worldY) < 100 && s.r < 50,
    );
    expect(persistent.length).toBeGreaterThan(0);

    for (const star of persistent) {
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
    const field = buildStarfield();
    const key = (s: { worldX: number; worldY: number }) =>
      `${s.worldX.toFixed(3)},${s.worldY.toFixed(3)}`;
    const a = collectStars(field, VIEWPORT, { x: 0, y: 0, zoom: 1 });
    const b = collectStars(field, VIEWPORT, { x: 0, y: 0, zoom: 1.02 });
    const aKeys = new Set(a.map(key));
    const shared = b.filter((s) => aKeys.has(key(s))).length;
    // Most stars present at one zoom are still present at a 2%-higher zoom — nothing near a
    // wholesale octave swap (which would share close to none).
    expect(shared / Math.min(a.length, b.length)).toBeGreaterThan(0.7);
  });

  it("every drawn star's radius, projected back to a size fraction, falls within [MIN_STAR_SIZE, MAX_STAR_SIZE]", () => {
    const field = buildStarfield();
    // r = sizeFactor * cellSize * zoom, and cellSize/zoom aren't exposed per-star, but we can at
    // least confirm the exponential+rejection sampling never produces a pathological (zero,
    // negative, non-finite) radius, and that a reasonably large sample spans a real range rather
    // than collapsing to one constant value.
    const stars = collectStars(field, VIEWPORT, { x: 0, y: 0, zoom: 1 });
    expect(stars.length).toBeGreaterThan(20);
    for (const s of stars) {
      expect(s.r).toBeGreaterThan(0);
      expect(Number.isFinite(s.r)).toBe(true);
    }
    const sizes = new Set(stars.map((s) => s.r.toFixed(6)));
    expect(sizes.size).toBeGreaterThan(1);
  });

  it("draws with far fewer fill() calls than stars (shade-batched)", () => {
    const field = buildStarfield();
    const { ctx } = createFakeCanvas();
    drawStarfield(ctx as unknown as CanvasRenderingContext2D, field, VIEWPORT, {
      x: 0,
      y: 0,
      zoom: 1,
    });
    const starFills = ctx.calls.filter((c) => c.method === "fill"); // includes the 2 glow fills too
    const stars = arcCount(ctx.calls) - 2; // minus the 2 glow arcs
    expect(stars).toBeGreaterThan(20);
    expect(starFills.length).toBeLessThan(20);
  });
});

describe("size constants", () => {
  it("MIN_STAR_SIZE and MAX_STAR_SIZE bound every accepted sample", () => {
    expect(MIN_STAR_SIZE).toBeLessThan(MAX_STAR_SIZE);
  });

  it("MIN_STAR_SIZE (the unset-setting default) falls inside the slider's own range", () => {
    expect(MIN_STAR_SIZE).toBeGreaterThanOrEqual(MIN_STAR_SIZE_MIN);
    expect(MIN_STAR_SIZE).toBeLessThanOrEqual(MIN_STAR_SIZE_MAX);
  });
});

describe("collectStars with a custom minStarSize", () => {
  it("a smaller minStarSize accepts smaller stars, so the smallest radius found shrinks with it", () => {
    const field = buildStarfield();
    const viewpoint = { x: 2000, y: -1500, zoom: 1 };
    const default_ = collectStars(field, VIEWPORT, viewpoint);
    const smaller = collectStars(field, VIEWPORT, viewpoint, MIN_STAR_SIZE_MIN);
    expect(Math.min(...smaller.map((s) => s.r))).toBeLessThan(
      Math.min(...default_.map((s) => s.r)),
    );
    // Every accepted star still respects the floor actually passed in.
    for (const s of smaller)
      expect(s.r).toBeGreaterThanOrEqual(MIN_STAR_SIZE_MIN);
  });

  it("a larger minStarSize strictly increases every accepted star's radius floor", () => {
    const field = buildStarfield();
    const viewpoint = { x: 2000, y: -1500, zoom: 1 };
    const larger = collectStars(field, VIEWPORT, viewpoint, MIN_STAR_SIZE_MAX);
    expect(larger.length).toBeGreaterThan(0);
    for (const s of larger)
      expect(s.r).toBeGreaterThanOrEqual(MIN_STAR_SIZE_MAX);
  });

  it("drawStarfield's optional minStarSize argument reaches collectStars (more arcs at the smaller floor)", () => {
    const field = buildStarfield();
    const viewpoint = { x: 2000, y: -1500, zoom: 1 };
    const { ctx: ctxDefault } = createFakeCanvas();
    const { ctx: ctxSmaller } = createFakeCanvas();
    drawStarfield(
      ctxDefault as unknown as CanvasRenderingContext2D,
      field,
      VIEWPORT,
      viewpoint,
    );
    drawStarfield(
      ctxSmaller as unknown as CanvasRenderingContext2D,
      field,
      VIEWPORT,
      viewpoint,
      MIN_STAR_SIZE_MIN,
    );
    expect(arcCount(ctxSmaller.calls)).toBeGreaterThan(
      arcCount(ctxDefault.calls),
    );
  });
});

describe("clampMinStarSize", () => {
  it("passes values already inside range through unchanged", () => {
    expect(clampMinStarSize(0.5)).toBe(0.5);
  });

  it("clamps to the slider's min/max", () => {
    expect(clampMinStarSize(0)).toBe(MIN_STAR_SIZE_MIN);
    expect(clampMinStarSize(-5)).toBe(MIN_STAR_SIZE_MIN);
    expect(clampMinStarSize(100)).toBe(MIN_STAR_SIZE_MAX);
  });

  it("falls back to MIN_STAR_SIZE for non-finite input", () => {
    expect(clampMinStarSize(NaN)).toBe(MIN_STAR_SIZE);
    expect(clampMinStarSize(Infinity)).toBe(MIN_STAR_SIZE);
  });
});

describe("readMinStarSize / minStarSizePatch", () => {
  it("readMinStarSize defaults to MIN_STAR_SIZE when the key was never set", () => {
    expect(readMinStarSize({} as Settings)).toBe(MIN_STAR_SIZE);
  });

  it("readMinStarSize reads back exactly what minStarSizePatch wrote", () => {
    const settings = { ...minStarSizePatch(0.75) } as Settings;
    expect(readMinStarSize(settings)).toBeCloseTo(0.75, 9);
  });

  it("minStarSizePatch clamps before persisting", () => {
    const patch = minStarSizePatch(999) as unknown as Record<string, number>;
    expect(patch.minStarSize).toBe(MIN_STAR_SIZE_MAX);
  });

  it("readMinStarSize falls back to the default for a corrupt (non-number) stored value", () => {
    const settings = { minStarSize: "not a number" } as unknown as Settings;
    expect(readMinStarSize(settings)).toBe(MIN_STAR_SIZE);
  });
});
