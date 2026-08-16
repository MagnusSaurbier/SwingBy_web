/**
 * T-11 DRAFT — viewport.ts: pure pan/zoom camera math. No canvas/DOM anywhere in this file.
 */
import { describe, expect, it } from "vitest";
import {
  clampZoom,
  createEditorCamera,
  fitCamera,
  MAX_ZOOM,
  MIN_ZOOM,
  panByScreenDelta,
  projectScreenToWorld,
  projectWorldToScreen,
  zoomAtScreenPoint,
} from "../src/editor/viewport.js";

const VIEWPORT = { width: 960, height: 600 };

describe("viewport: projectWorldToScreen / projectScreenToWorld round-trip", () => {
  it("round-trips across a wide zoom range", () => {
    const zooms = [MIN_ZOOM, 0.25, 0.5, 1, 2, 4, MAX_ZOOM];
    const points = [
      { x: 0, y: 0 },
      { x: 1300, y: 900 },
      { x: -500, y: 2600 },
      { x: 2600, y: 1800 },
    ];
    let maxErr = 0;
    for (const zoom of zooms) {
      const camera = createEditorCamera(1300, 900, zoom);
      for (const p of points) {
        const screen = projectWorldToScreen(p.x, p.y, camera, VIEWPORT);
        const back = projectScreenToWorld(screen.x, screen.y, camera, VIEWPORT);
        maxErr = Math.max(maxErr, Math.abs(back.x - p.x), Math.abs(back.y - p.y));
      }
    }
    expect(maxErr).toBeLessThan(1e-6);
  });
});

describe("clampZoom", () => {
  it("clamps into [MIN_ZOOM, MAX_ZOOM]", () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe("panByScreenDelta", () => {
  it("moves the camera opposite the drag so the same world point stays under the cursor", () => {
    const camera = createEditorCamera(0, 0, 2);
    const before = projectScreenToWorld(480, 300, camera, VIEWPORT);
    panByScreenDelta(camera, 50, -20);
    const after = projectScreenToWorld(480 + 50, 300 - 20, camera, VIEWPORT);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
});

describe("zoomAtScreenPoint", () => {
  it("keeps the world point under the cursor fixed on screen after zooming", () => {
    const camera = createEditorCamera(300, 200, 1);
    const cursor = { x: 700, y: 250 };
    const worldBefore = projectScreenToWorld(cursor.x, cursor.y, camera, VIEWPORT);
    zoomAtScreenPoint(camera, 3, cursor, VIEWPORT);
    expect(camera.zoom).toBeGreaterThan(1);
    const screenAfter = projectWorldToScreen(worldBefore.x, worldBefore.y, camera, VIEWPORT);
    expect(screenAfter.x).toBeCloseTo(cursor.x, 6);
    expect(screenAfter.y).toBeCloseTo(cursor.y, 6);
  });

  it("clamps at MAX_ZOOM / MIN_ZOOM under extreme wheel input", () => {
    const camera = createEditorCamera(0, 0, 1);
    zoomAtScreenPoint(camera, 500, { x: 480, y: 300 }, VIEWPORT);
    expect(camera.zoom).toBe(MAX_ZOOM);
    zoomAtScreenPoint(camera, -1000, { x: 480, y: 300 }, VIEWPORT);
    expect(camera.zoom).toBe(MIN_ZOOM);
  });
});

describe("fitCamera", () => {
  it("returns a sane default for an empty level", () => {
    const camera = fitCamera([], VIEWPORT);
    expect(camera.zoom).toBeGreaterThan(0);
    expect(Number.isFinite(camera.x)).toBe(true);
    expect(Number.isFinite(camera.y)).toBe(true);
  });

  it("centers on the bounding box of the given points", () => {
    const camera = fitCamera(
      [
        { x: 0, y: 0 },
        { x: 200, y: 100 },
      ],
      VIEWPORT,
    );
    expect(camera.x).toBeCloseTo(100, 6);
    expect(camera.y).toBeCloseTo(50, 6);
  });
});
