import { describe, expect, it } from "vitest";
import type { Vec2 } from "@swingby/core/types";
import { createTrailDrawer } from "./trail";
import { createFakeCanvas } from "./__tests__/fakeCanvas";

function line(n: number, startX = 0, stepX = 5): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) pts.push({ x: startX + i * stepX, y: 900 });
  return pts;
}

describe("trail", () => {
  it("draws nothing for fewer than 2 points", () => {
    const drawer = createTrailDrawer();
    const { ctx } = createFakeCanvas();
    drawer.draw(ctx as unknown as CanvasRenderingContext2D, [], 0, 0, 1, {
      width: 800,
      height: 600,
    });
    drawer.draw(
      ctx as unknown as CanvasRenderingContext2D,
      [{ x: 0, y: 0 }],
      0,
      0,
      1,
      { width: 800, height: 600 },
    );
    expect(ctx.calls.length).toBe(0);
  });

  it("draws in multiple alpha buckets that get more opaque toward the head (most recent point)", () => {
    const drawer = createTrailDrawer();
    const { ctx } = createFakeCanvas();
    const pts = line(5000, 0, 0.5); // fits inside the camera view the whole way
    drawer.draw(ctx as unknown as CanvasRenderingContext2D, pts, 1250, 900, 1, {
      width: 2600,
      height: 1800,
    });

    const strokes = ctx.calls.filter((c) => c.method === "stroke");
    expect(strokes.length).toBeGreaterThan(1); // more than one bucket => a fade, not a flat polyline
    expect(strokes.length).toBeLessThanOrEqual(24);

    const alphas = strokes.map((c) => {
      const strokeStyle = c.args[0] as string;
      const m = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/.exec(strokeStyle);
      return m ? Number(m[1]) : NaN;
    });
    for (const a of alphas) expect(Number.isNaN(a)).toBe(false);
    // Monotonically increasing: tail (oldest, drawn first) is dimmer than head (newest, drawn last).
    for (let i = 1; i < alphas.length; i++) {
      expect(alphas[i]!).toBeGreaterThan(alphas[i - 1]!);
    }
  });

  it("culls entirely offscreen trails without touching the canvas", () => {
    const drawer = createTrailDrawer();
    const { ctx } = createFakeCanvas();
    // Camera centered far away from these points, zoomed in, viewport small: bbox cannot intersect.
    const pts = line(100, 1_000_000, 1);
    drawer.draw(ctx as unknown as CanvasRenderingContext2D, pts, 0, 0, 1, {
      width: 800,
      height: 600,
    });
    expect(ctx.calls.length).toBe(0);
  });

  it("decimates a dense trail (sub-pixel spacing) down to far fewer drawn vertices, but still reaches the head", () => {
    const drawer = createTrailDrawer();
    const { ctx } = createFakeCanvas();
    // 5000 points spanning only 40 world units at zoom 1 -> ~0.008 world units apart -> far under
    // the MIN_SEGMENT_PX screen-space floor. Mirrors real 144Hz-sampled gameplay trails.
    const pts = line(5000, 0, 0.008);
    const viewport = { width: 800, height: 600 };
    drawer.draw(
      ctx as unknown as CanvasRenderingContext2D,
      pts,
      20,
      900,
      1,
      viewport,
    );

    const lineTos = ctx.calls.filter((c) => c.method === "lineTo");
    expect(lineTos.length).toBeGreaterThan(0);
    expect(lineTos.length).toBeLessThan(200); // decimated hard from 5000 raw points

    // The head (most recent point, last in the input array) must still be represented: the very
    // last drawn coordinate should equal the last input point's screen position.
    const last = pts[pts.length - 1]!;
    const lastCall = lineTos[lineTos.length - 1]!;
    expect(lastCall.args[0]).toBeCloseTo(400 + (last.x - 20) * 1, 6); // halfW + (x - camX)*zoom
  });

  it("reuses its scratch buffer across draws (no capacity growth for a repeated same-size trail)", () => {
    const drawer = createTrailDrawer(10);
    const { ctx } = createFakeCanvas();
    const pts = line(4, 0, 1);
    const viewport = { width: 800, height: 600 };
    // Should not throw even though capacity(10) > points(4); exercises the "already big enough" path.
    expect(() => {
      drawer.draw(
        ctx as unknown as CanvasRenderingContext2D,
        pts,
        0,
        900,
        1,
        viewport,
      );
      drawer.draw(
        ctx as unknown as CanvasRenderingContext2D,
        pts,
        0,
        900,
        1,
        viewport,
      );
    }).not.toThrow();
  });
});
