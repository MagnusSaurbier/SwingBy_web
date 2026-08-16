import { describe, expect, it } from "vitest";
import {
  drawBoundsWarning,
  drawForceVector,
  drawGoalRing,
  drawResetFlash,
} from "./overlays";
import { createFakeCanvas } from "./__tests__/fakeCanvas";

describe("drawGoalRing", () => {
  it("pulses radius by +/-8% around goalRange*zoom via the clock", () => {
    const { ctx: ctxA } = createFakeCanvas();
    drawGoalRing(ctxA as unknown as CanvasRenderingContext2D, 0, 0, 50, 1, 0); // sin(0) = 0 -> pulse = 1
    const { ctx: ctxB } = createFakeCanvas();
    drawGoalRing(
      ctxB as unknown as CanvasRenderingContext2D,
      0,
      0,
      50,
      1,
      Math.PI / 6,
    ); // sin(pi/2)=1 -> pulse = 1.08

    const ringA = ctxA.calls.find((c) => c.method === "arc")!;
    const ringB = ctxB.calls.find((c) => c.method === "arc")!;
    expect(ringA.args[2]).toBeCloseTo(50, 10);
    expect(ringB.args[2]).toBeCloseTo(54, 10);
  });
});

describe("drawForceVector", () => {
  it("skips drawing when the scaled vector is below the visibility threshold", () => {
    const { ctx } = createFakeCanvas();
    drawForceVector(
      ctx as unknown as CanvasRenderingContext2D,
      100,
      100,
      0,
      0,
      1,
    );
    expect(ctx.calls.length).toBe(0);
  });

  it("draws a line + arrowhead circle for a visible force", () => {
    const { ctx } = createFakeCanvas();
    drawForceVector(
      ctx as unknown as CanvasRenderingContext2D,
      100,
      100,
      0.01,
      0,
      1,
    );
    expect(ctx.calls.some((c) => c.method === "lineTo")).toBe(true);
    expect(ctx.calls.some((c) => c.method === "arc")).toBe(true);
  });
});

describe("drawBoundsWarning", () => {
  it("draws nothing at zero intensity", () => {
    const { ctx } = createFakeCanvas();
    drawBoundsWarning(
      ctx as unknown as CanvasRenderingContext2D,
      { width: 800, height: 600 },
      0,
      0,
    );
    expect(ctx.calls.length).toBe(0);
  });

  it("draws two strokeRects (glow + border) at nonzero intensity", () => {
    const { ctx } = createFakeCanvas();
    drawBoundsWarning(
      ctx as unknown as CanvasRenderingContext2D,
      { width: 800, height: 600 },
      0.6,
      0,
    );
    const strokes = ctx.calls.filter((c) => c.method === "strokeRect");
    expect(strokes.length).toBe(2);
  });
});

describe("drawResetFlash", () => {
  it("draws nothing at zero", () => {
    const { ctx } = createFakeCanvas();
    drawResetFlash(
      ctx as unknown as CanvasRenderingContext2D,
      { width: 800, height: 600 },
      0,
    );
    expect(ctx.calls.length).toBe(0);
  });

  it("draws a full-viewport fillRect scaled by flash", () => {
    const { ctx } = createFakeCanvas();
    drawResetFlash(
      ctx as unknown as CanvasRenderingContext2D,
      { width: 800, height: 600 },
      1,
    );
    const rect = ctx.calls.find((c) => c.method === "fillRect")!;
    expect(rect.args.slice(0, 4)).toEqual([0, 0, 800, 600]);
  });
});
