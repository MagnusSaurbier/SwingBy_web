import { describe, expect, it } from "vitest";
import { screenToWorldXY, worldToScreenXY, type Viewport } from "./transform";

/**
 * T-11 DRAFT hit-tests directly against worldToScreen/screenToWorld, so these must be exact
 * inverses (task doc: "within 1e-9 across the full zoom range"). This sweeps a broad grid of
 * camera positions, zoom levels (including Godot's editor extremes, 0.12-5.0 —
 * reference/godot/scripts/GameWorld.gd:500 `clampf(..., 0.12, 5.0)`), viewport sizes and world
 * points, and reports the actual max error rather than asserting a single spot check.
 */

const VIEWPORTS: Viewport[] = [
  { width: 800, height: 600 },
  { width: 1920, height: 1080 },
  { width: 375, height: 812 }, // mobile portrait
  { width: 1, height: 1 },
];

const ZOOMS = [0.0001, 0.001, 0.01, 0.12, 0.5, 1, 1.7, 2.5, 5, 5.5, 10, 100];

const CAMERAS = [
  { x: 0, y: 0 },
  { x: 1300, y: 900 },
  { x: -500, y: -500 },
  { x: 2600, y: 1800 },
];

const WORLD_POINTS = [
  { x: 0, y: 0 },
  { x: 2600, y: 1800 },
  { x: 1300, y: 900 },
  { x: -1000, y: -1000 },
  { x: 0.001, y: 0.001 },
  { x: 999999, y: -999999 },
];

describe("worldToScreen / screenToWorld", () => {
  it("are exact inverses (world -> screen -> world) across the full sweep", () => {
    let maxError = 0;
    let samples = 0;
    for (const viewport of VIEWPORTS) {
      for (const zoom of ZOOMS) {
        for (const camera of CAMERAS) {
          for (const p of WORLD_POINTS) {
            const screen = worldToScreenXY(p.x, p.y, camera.x, camera.y, zoom, viewport);
            const back = screenToWorldXY(screen.x, screen.y, camera.x, camera.y, zoom, viewport);
            const errX = Math.abs(back.x - p.x);
            const errY = Math.abs(back.y - p.y);
            maxError = Math.max(maxError, errX, errY);
            samples++;
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`worldToScreen/screenToWorld round-trip: ${samples} samples, max abs error = ${maxError.toExponential(3)}`);
    expect(samples).toBeGreaterThan(1000);
    expect(maxError).toBeLessThan(1e-9);
  });

  it("are exact inverses (screen -> world -> screen) across the full sweep", () => {
    let maxError = 0;
    const SCREEN_POINTS = [
      { x: 0, y: 0 },
      { x: 1920, y: 1080 },
      { x: 960, y: 540 },
      { x: -50, y: -50 },
    ];
    for (const viewport of VIEWPORTS) {
      for (const zoom of ZOOMS) {
        for (const camera of CAMERAS) {
          for (const s of SCREEN_POINTS) {
            const world = screenToWorldXY(s.x, s.y, camera.x, camera.y, zoom, viewport);
            const back = worldToScreenXY(world.x, world.y, camera.x, camera.y, zoom, viewport);
            maxError = Math.max(maxError, Math.abs(back.x - s.x), Math.abs(back.y - s.y));
          }
        }
      }
    }
    console.log(`screenToWorld/worldToScreen round-trip: max abs error = ${maxError.toExponential(3)}`);
    expect(maxError).toBeLessThan(1e-9);
  });

  it("worldToScreen maps the camera target to the viewport center", () => {
    const viewport: Viewport = { width: 1000, height: 800 };
    const s = worldToScreenXY(500, 500, 500, 500, 3, viewport);
    expect(s.x).toBeCloseTo(500, 12);
    expect(s.y).toBeCloseTo(400, 12);
  });

  it("clamps non-positive zoom instead of dividing by zero", () => {
    const viewport: Viewport = { width: 100, height: 100 };
    const s = worldToScreenXY(10, 10, 0, 0, 0, viewport);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Number.isFinite(s.y)).toBe(true);
    const w = screenToWorldXY(50, 50, 0, 0, -5, viewport);
    expect(Number.isFinite(w.x)).toBe(true);
    expect(Number.isFinite(w.y)).toBe(true);
  });
});
