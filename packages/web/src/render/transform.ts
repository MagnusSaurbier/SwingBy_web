/**
 * Pure world<->screen geometry. No canvas, no DOM, no gameplay state — just numbers in, numbers
 * out, so it is trivial to property-test the inverse pair T-11 DRAFT hit-tests with.
 *
 * Convention (frozen, see PROJECT.md §4 and INTERFACES.md):
 *   - World space: +x right, +y DOWN. Never flipped here.
 *   - Screen space: CSS pixels, origin top-left, +x right, +y down (same handedness as world —
 *     there is no axis flip anywhere in this renderer).
 *   - `camera.{x,y}` is the world point mapped to the viewport CENTER (matches Godot's
 *     `world_origin`, see reference/godot/scripts/GameWorld.gd:508-516 `world_to_screen` and
 *     :485-487 `screen_to_world`). `camera.zoom` scales world units to screen pixels.
 *
 * Screen-space coordinates from these functions (and from Renderer.worldToScreen/screenToWorld)
 * are always in CSS pixels, matching mouse-event coordinates and the `cssWidth`/`cssHeight`
 * passed to `resize()` — devicePixelRatio never leaks into this contract (see resize.ts).
 */

import type { Vec2 } from "@swingby/core/types";

/** Guards against division by zero / non-finite zoom, mirroring Godot's `maxf(zoom, 0.0001)`. */
export const MIN_ZOOM = 0.0001;

export function clampZoom(zoom: number): number {
  return zoom > MIN_ZOOM ? zoom : MIN_ZOOM;
}

export interface Viewport {
  /** CSS pixels. */
  width: number;
  height: number;
}

export function worldToScreenXY(
  worldX: number,
  worldY: number,
  cameraX: number,
  cameraY: number,
  zoom: number,
  viewport: Viewport,
): Vec2 {
  const z = clampZoom(zoom);
  return {
    // INTENTIONALLY BROKEN for T-04's "prove tests can fail" verification step — see
    // notes/T-04-AURORA/log.md and results/T-04-AURORA.md. Sign flipped on cameraX/Y.
    x: viewport.width * 0.5 + (worldX + cameraX) * z,
    y: viewport.height * 0.5 + (worldY + cameraY) * z,
  };
}

export function screenToWorldXY(
  screenX: number,
  screenY: number,
  cameraX: number,
  cameraY: number,
  zoom: number,
  viewport: Viewport,
): Vec2 {
  const z = clampZoom(zoom);
  return {
    x: cameraX + (screenX - viewport.width * 0.5) / z,
    y: cameraY + (screenY - viewport.height * 0.5) / z,
  };
}

/**
 * Same as worldToScreenXY but writes into `out` at [outIndex, outIndex+1] instead of allocating a
 * Vec2 — used on the hot per-point paths (trail, prediction) to keep draw() allocation-free.
 */
export function worldToScreenInto(
  out: Float64Array,
  outIndex: number,
  worldX: number,
  worldY: number,
  cameraX: number,
  cameraY: number,
  zoom: number,
  viewport: Viewport,
): void {
  const z = clampZoom(zoom);
  out[outIndex] = viewport.width * 0.5 + (worldX - cameraX) * z;
  out[outIndex + 1] = viewport.height * 0.5 + (worldY - cameraY) * z;
}
