/**
 * T-05 FLYWHEEL — camera: asymmetric auto-zoom + first-boost/goal-capture shake.
 *
 * Target zoom is `min(zoomX, zoomY)` from the player's distance from the camera's fixed origin on
 * each axis vs. `viewportHalf * ZOOM_MARGIN`, clamped so it only ever zooms OUT, never in past 1:1.
 * Per-frame smoothing uses an asymmetric rate (`ZOOM_IN_SMOOTHING` when growing, `ZOOM_SMOOTHING`
 * when shrinking), frame-rate-corrected exponential decay `factor = 1 - exp(-rate * dt)`.
 *
 * Deliberately not window-size-dependent: a "look-at point reassigned every frame to half the
 * window's pixel size" quantity has no portable meaning for an arbitrarily-resizable canvas (see
 * notes/archive/T-05-FLYWHEEL/log.md and notes/archive/T-01-KEPLER/log.md for the same wall hit by
 * `TickResult.outOfBounds`). Instead, this module takes a level-specific fixed origin chosen ONCE
 * per attempt (by the caller, via
 * `createCameraState`/`recenterOrigin`) — the bounding-box center of the level's starting bodies is
 * `loop.ts`'s choice, but this module doesn't care how the origin was picked, only that it's fixed
 * for the duration of an attempt.
 *
 * Shake (`_trigger_shake`, GameWorld.gd:902-905) is presentation-only per PROJECT.md §4 ("Rendering
 * and audio may do whatever they like") and uses `Math.random` freely — never read back into
 * simulation state. Because the frozen `Camera` type (`packages/web/src/render/index.ts`) is just
 * `{x, y, zoom}` with no separate shake channel (T-04's own log confirms the renderer's
 * `worldToScreen`/`screenToWorld` are pure functions of `Camera`, deliberately with no hidden shake
 * state), shake here is baked directly into the `x/y` handed to the renderer each frame, jittered in
 * WORLD units scaled by `1/zoom` so that after the renderer's `(world - camera) * zoom` multiply the
 * on-screen displacement amplitude is independent of current zoom — matching the effect (constant
 * screen-space shake) of Godot's own post-zoom pixel-space `shake_offset`
 * (`GameWorld.gd:510-516`), just applied on the other side of the multiply.
 */

import { ZOOM_IN_SMOOTHING, ZOOM_MARGIN, ZOOM_SMOOTHING } from "@swingby/core";

export interface CameraPoint {
  x: number;
  y: number;
  zoom: number;
}

export interface CameraState {
  /** Fixed look-at point for the current attempt (world units). */
  originX: number;
  originY: number;
  zoom: number;
  targetZoom: number;
  shakeStrength: number;
  shakeDecay: number;
}

export function createCameraState(
  originX: number,
  originY: number,
): CameraState {
  return {
    originX,
    originY,
    zoom: 1,
    targetZoom: 1,
    shakeStrength: 0,
    shakeDecay: 0,
  };
}

/** Re-centers the origin (e.g. on restart) and snaps zoom to 1 with no smoothing transient —
 *  mirrors `_load_level` setting `zoom_factor = target_zoom_factor` immediately on level (re)load
 *  (GameWorld.gd:596-598), rather than animating in from whatever zoom the previous attempt ended
 *  on. Also clears any in-flight shake. */
export function recenterCamera(
  state: CameraState,
  originX: number,
  originY: number,
): void {
  state.originX = originX;
  state.originY = originY;
  state.zoom = 1;
  state.targetZoom = 1;
  state.shakeStrength = 0;
  state.shakeDecay = 0;
}

/** Bounding-box center of a set of points. Used once per attempt (hydrate/restart time) to pick the
 *  camera's fixed origin — see the module doc comment for why this substitutes for Godot's
 *  viewport-pixel-size hack. Returns `(0, 0)` for an empty input (never expected in practice — every
 *  valid `Level` has at least one body per T-03's `validate()`). */
export function boundingBoxCenter(
  points: ReadonlyArray<{ x: number; y: number }>,
): {
  x: number;
  y: number;
} {
  if (points.length === 0) return { x: 0, y: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * Recomputes `state.targetZoom` from the player's current position. Mirrors
 * `GameWorld._recalculate_zoom` exactly (GameWorld.gd:662-676): zoom out just enough that the
 * player's distance from the origin on the tighter axis sits at `viewportHalf * ZOOM_MARGIN`, never
 * zooming in past 1.0.
 */
export function recalcTargetZoom(
  state: CameraState,
  playerX: number,
  playerY: number,
  viewportWidth: number,
  viewportHeight: number,
): void {
  const halfW = viewportWidth * 0.5 * ZOOM_MARGIN;
  const halfH = viewportHeight * 0.5 * ZOOM_MARGIN;
  const xDist = Math.abs(playerX - state.originX);
  const yDist = Math.abs(playerY - state.originY);
  if (xDist <= halfW && yDist <= halfH) {
    state.targetZoom = 1;
    return;
  }
  const zoomX = xDist > 0 ? halfW / xDist : 1;
  const zoomY = yDist > 0 ? halfH / yDist : 1;
  state.targetZoom = Math.min(zoomX, zoomY);
}

/**
 * Frame-rate-independent asymmetric exponential smoothing toward `targetZoom`, plus shake decay.
 * Call once per RENDERED frame with the (already frame-clamped) delta in seconds — never a raw
 * unclamped `dt`, never a tick count. Mirrors `GameWorld.gd:442-448`.
 */
export function stepCamera(state: CameraState, dt: number): void {
  const rate =
    state.targetZoom > state.zoom ? ZOOM_IN_SMOOTHING : ZOOM_SMOOTHING;
  const factor = 1 - Math.exp(-rate * dt);
  state.zoom = state.zoom + (state.targetZoom - state.zoom) * factor;
  if (Math.abs(state.zoom - state.targetZoom) < 0.001)
    state.zoom = state.targetZoom;

  if (state.shakeStrength > 0) {
    state.shakeStrength = Math.max(
      0,
      state.shakeStrength - state.shakeDecay * dt,
    );
  }
}

/** Mirrors `_trigger_shake` (GameWorld.gd:902-905): strength is the MAX of current and incoming
 *  (a bigger shake already in flight is not weakened by a smaller one landing mid-decay), decay is
 *  simply overwritten. */
export function triggerShake(
  state: CameraState,
  amount: number,
  decay: number,
): void {
  state.shakeStrength = Math.max(state.shakeStrength, amount);
  state.shakeDecay = decay;
}

/** Produces this frame's `{x, y, zoom}` for `Renderer.draw()`, with shake jitter applied (see the
 *  module doc comment for the 1/zoom scaling reasoning). Uses `Math.random` — presentation only,
 *  never read back into simulation state, per PROJECT.md §4. */
export function cameraForFrame(state: CameraState): CameraPoint {
  if (state.shakeStrength <= 0) {
    return { x: state.originX, y: state.originY, zoom: state.zoom };
  }
  const z = Math.max(state.zoom, 1e-4);
  const jitterX = ((Math.random() * 2 - 1) * state.shakeStrength) / z;
  const jitterY = ((Math.random() * 2 - 1) * state.shakeStrength) / z;
  return {
    x: state.originX + jitterX,
    y: state.originY + jitterY,
    zoom: state.zoom,
  };
}
