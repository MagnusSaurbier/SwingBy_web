import { describe, expect, it } from "vitest";
import { drawPlanet, drawPlayer, drawSun } from "./bodies";
import { createSpriteSet } from "./sprites";
import { createFakeCanvas } from "./__tests__/fakeCanvas";
import { makeBody } from "./__tests__/fixtures";

describe("drawSun", () => {
  it("draws exactly 3 concentric circles (halo, mid ring, core)", () => {
    const { ctx } = createFakeCanvas();
    drawSun(ctx as unknown as CanvasRenderingContext2D, 400, 300, 20, 1);
    const arcs = ctx.calls.filter((c) => c.method === "arc");
    expect(arcs.length).toBe(3);
    const radii = arcs.map((c) => c.args[2] as number).sort((a, b) => a - b);
    expect(radii).toEqual([20, 36, 60]); // core(1x), mid(1.8x), halo(3x)
  });
});

describe("drawPlanet", () => {
  it("draws a backing circle, a shaded sphere, and a rotated equator band", () => {
    const { ctx } = createFakeCanvas();
    drawPlanet(ctx as unknown as CanvasRenderingContext2D, 400, 300, 14, 0.7, 1);
    expect(ctx.calls.filter((c) => c.method === "arc").length).toBe(3); // backing + sphere + band
    expect(ctx.calls.some((c) => c.method === "createRadialGradient")).toBe(true);
    const rotateCall = ctx.calls.find((c) => c.method === "rotate");
    expect(rotateCall).toBeDefined();
    expect(rotateCall!.args[0]).toBeCloseTo(0.7, 12);
  });

  it("enforces a minimum on-screen radius even at zero zoom", () => {
    const { ctx } = createFakeCanvas();
    drawPlanet(ctx as unknown as CanvasRenderingContext2D, 0, 0, 1, 0, 0);
    const sphereArc = ctx.calls.filter((c) => c.method === "arc")[1]!; // backing, sphere, band
    expect(sphereArc.args[2]).toBeGreaterThanOrEqual(6);
  });
});

describe("drawPlayer", () => {
  it("draws the HUD glow, then falls back to a drawn silhouette when no sprite is loaded", () => {
    const { ctx } = createFakeCanvas();
    const sprites = createSpriteSet(); // no `Image` global under plain-Node vitest -> get() is always null
    const body = makeBody({ type: "player", angle: 1.2, boostType: 2, isBoosting: true });
    drawPlayer(ctx as unknown as CanvasRenderingContext2D, sprites, 400, 300, body, 1);

    expect(ctx.calls[0]!.method).toBe("beginPath"); // HUD glow circle starts the sequence
    expect(ctx.calls.some((c) => c.method === "arc")).toBe(true); // glow circle
    expect(ctx.calls.some((c) => c.method === "drawImage")).toBe(false); // no sprite available
    expect(ctx.calls.some((c) => c.method === "translate")).toBe(true);
    expect(ctx.calls.some((c) => c.method === "rotate")).toBe(true);
    // Fallback silhouette is a filled polygon (moveTo/lineTo/closePath/fill), plus an extra flame
    // polygon because isBoosting is true.
    const fillCount = ctx.calls.filter((c) => c.method === "fill").length;
    expect(fillCount).toBeGreaterThanOrEqual(1 + 1 + 1); // hud glow + hull + flame
  });

  it("rotates by body.angle, not by a recomputed velocity angle", () => {
    const { ctx } = createFakeCanvas();
    const sprites = createSpriteSet();
    const body = makeBody({ type: "player", angle: 2.5, xVel: 0, yVel: 0 });
    drawPlayer(ctx as unknown as CanvasRenderingContext2D, sprites, 0, 0, body, 1);
    const rotateCall = ctx.calls.find((c) => c.method === "rotate")!;
    expect(rotateCall.args[0]).toBeCloseTo(2.5, 12);
  });
});
