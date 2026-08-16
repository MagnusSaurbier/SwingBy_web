import { describe, expect, it } from "vitest";
import type { Prediction } from "@swingby/core/types";
import { drawPrediction } from "./prediction";
import { createFakeCanvas } from "./__tests__/fakeCanvas";

describe("prediction", () => {
  it("draws one fill() call for the player track and one for all planet tracks combined", () => {
    const { ctx } = createFakeCanvas();
    const prediction: Prediction = {
      player: [
        { x: 100, y: 100 },
        { x: 110, y: 100 },
        { x: 120, y: 100 },
      ],
      planets: [
        [
          { x: 200, y: 200 },
          { x: 210, y: 200 },
        ],
        [{ x: 300, y: 300 }],
      ],
    };
    drawPrediction(
      ctx as unknown as CanvasRenderingContext2D,
      prediction,
      0,
      0,
      1,
      { width: 800, height: 600 },
    );

    const fills = ctx.calls.filter((c) => c.method === "fill");
    expect(fills.length).toBe(2); // one for the player group, one for the planets group

    const arcs = ctx.calls.filter((c) => c.method === "arc");
    // 3 player samples + 3 planet samples = 6 arcs total, one per point, regardless of track count.
    expect(arcs.length).toBe(6);
  });

  it("draws nothing when both player and planet tracks are empty", () => {
    const { ctx } = createFakeCanvas();
    const prediction: Prediction = { player: [], planets: [[], []] };
    drawPrediction(
      ctx as unknown as CanvasRenderingContext2D,
      prediction,
      0,
      0,
      1,
      { width: 800, height: 600 },
    );
    expect(ctx.calls.length).toBe(0);
  });

  it("player dot radius grows with zoom, floored at 1.25", () => {
    const prediction: Prediction = { player: [{ x: 0, y: 0 }], planets: [] };
    const { ctx: ctxLowZoom } = createFakeCanvas();
    drawPrediction(
      ctxLowZoom as unknown as CanvasRenderingContext2D,
      prediction,
      0,
      0,
      0.01,
      { width: 800, height: 600 },
    );
    const { ctx: ctxHighZoom } = createFakeCanvas();
    drawPrediction(
      ctxHighZoom as unknown as CanvasRenderingContext2D,
      prediction,
      0,
      0,
      5,
      { width: 800, height: 600 },
    );

    const radiusLow = ctxLowZoom.calls.find((c) => c.method === "arc")!
      .args[2] as number;
    const radiusHigh = ctxHighZoom.calls.find((c) => c.method === "arc")!
      .args[2] as number;
    expect(radiusLow).toBeCloseTo(1.25, 10);
    expect(radiusHigh).toBeCloseTo(9, 10);
  });
});
