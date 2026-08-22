/**
 * T-05 FLYWHEEL — camera: dynamic view-fitting + first-boost/goal-capture shake.
 *
 * Camera tracking window: every frame the fit rect is the bounding box of the PLAYER, all SUNS,
 * and the TARGET body (`world.goalIndex`) — deliberately excluding non-target planets, which may
 * freely drift outside the visible area. The rect is padded by `FIT_MARGIN_RATIO` on each side,
 * then `targetZoom = min(viewportWidth/width, viewportHeight/height)` and `targetOrigin` is the
 * rect's center — both zoom AND pan are dynamic now (previously only zoom moved, out from a fixed
 * per-attempt origin; see notes/archive/T-05-FLYWHEEL/log.md for that earlier design).
 *
 * Zoom-in floor: a naive fit can zoom in without bound if the tracked bodies collapse toward each
 * other (or only one is left on screen). `baseFitWidth/Height` freezes the padded rect's size at
 * the moment the camera is (re)centered for an attempt; every later frame's rect is floored to
 * `max(0.5 * baseFit, MIN_FIT_SIZE)` per axis before computing zoom, so the camera can zoom out
 * freely but never in past 2x its starting fit.
 *
 * Per-frame smoothing is frame-rate-independent exponential decay `factor = 1 - exp(-rate * dt)`,
 * applied to zoom (asymmetric: `ZOOM_IN_SMOOTHING` growing / `ZOOM_SMOOTHING` shrinking) and to
 * the origin pan (symmetric, `ZOOM_SMOOTHING`) — mirrors `GameWorld.gd:442-448`'s zoom easing,
 * extended to cover panning now that the origin itself moves.
 *
 * Shake (`_trigger_shake`, GameWorld.gd:902-905) is presentation-only per docs/GAME.md §4 ("Rendering
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

import {
  FIT_MARGIN_RATIO,
  MIN_FIT_SIZE,
  ZOOM_IN_SMOOTHING,
  ZOOM_SMOOTHING,
} from "@swingby/core";

export interface CameraPoint {
  x: number;
  y: number;
  zoom: number;
}

export interface CameraState {
  /** Current look-at point (world units) — the center of the tracked fit rect, smoothed toward
   *  `targetOriginX/Y`. */
  originX: number;
  originY: number;
  targetOriginX: number;
  targetOriginY: number;
  zoom: number;
  targetZoom: number;
  /** Padded fit-rect size captured once per attempt, at (re)center time — see module doc comment
   *  for how this floors later zoom-in. */
  baseFitWidth: number;
  baseFitHeight: number;
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
    targetOriginX: originX,
    targetOriginY: originY,
    zoom: 1,
    targetZoom: 1,
    baseFitWidth: MIN_FIT_SIZE,
    baseFitHeight: MIN_FIT_SIZE,
    shakeStrength: 0,
    shakeDecay: 0,
  };
}

interface FitRect {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

/** Bounding rect of `points`, padded by `FIT_MARGIN_RATIO` on each side (so the result is
 *  `(1 + 2*FIT_MARGIN_RATIO)`x the raw bounding box), floored to `MIN_FIT_SIZE` per axis. Returns
 *  a rect centered at `(0, 0)` at `MIN_FIT_SIZE` for an empty input (never expected in practice —
 *  every valid `Level` has a player, per T-03's `validate()`). */
function computeFitRect(
  points: ReadonlyArray<{ x: number; y: number }>,
): FitRect {
  if (points.length === 0) {
    return {
      centerX: 0,
      centerY: 0,
      width: MIN_FIT_SIZE,
      height: MIN_FIT_SIZE,
    };
  }
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
  const rawWidth = maxX - minX;
  const rawHeight = maxY - minY;
  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: Math.max(rawWidth * (1 + 2 * FIT_MARGIN_RATIO), MIN_FIT_SIZE),
    height: Math.max(rawHeight * (1 + 2 * FIT_MARGIN_RATIO), MIN_FIT_SIZE),
  };
}

/**
 * (Re)centers the camera for a fresh attempt: fits `points` (player + suns + target) immediately,
 * with no smoothing transient (mirrors `_load_level` snapping `zoom_factor = target_zoom_factor`
 * immediately on level (re)load, GameWorld.gd:596-598) and records the resulting rect size as
 * `baseFitWidth/Height`, the floor later frames' zoom-in is measured against. Also clears any
 * in-flight shake.
 */
export function recenterCameraToFit(
  state: CameraState,
  points: ReadonlyArray<{ x: number; y: number }>,
  viewportWidth: number,
  viewportHeight: number,
): void {
  const rect = computeFitRect(points);
  state.baseFitWidth = rect.width;
  state.baseFitHeight = rect.height;
  state.originX = rect.centerX;
  state.originY = rect.centerY;
  state.targetOriginX = rect.centerX;
  state.targetOriginY = rect.centerY;
  state.zoom = Math.min(
    viewportWidth / rect.width,
    viewportHeight / rect.height,
  );
  state.targetZoom = state.zoom;
  state.shakeStrength = 0;
  state.shakeDecay = 0;
}

/**
 * Recomputes `state.targetOriginX/Y` and `state.targetZoom` from the current fit rect of `points`
 * (player + suns + target), floored per axis to `max(0.5 * baseFit, MIN_FIT_SIZE)` so the camera
 * never zooms in past 2x its starting fit — see module doc comment.
 */
export function recalcTargetFit(
  state: CameraState,
  points: ReadonlyArray<{ x: number; y: number }>,
  viewportWidth: number,
  viewportHeight: number,
): void {
  const rect = computeFitRect(points);
  const minWidth = Math.max(state.baseFitWidth * 0.5, MIN_FIT_SIZE);
  const minHeight = Math.max(state.baseFitHeight * 0.5, MIN_FIT_SIZE);
  const width = Math.max(rect.width, minWidth);
  const height = Math.max(rect.height, minHeight);
  state.targetOriginX = rect.centerX;
  state.targetOriginY = rect.centerY;
  state.targetZoom = Math.min(viewportWidth / width, viewportHeight / height);
}

/**
 * Frame-rate-independent exponential smoothing of zoom (asymmetric: faster zooming in than out)
 * and of the origin pan (symmetric), plus shake decay. Call once per RENDERED frame with the
 * (already frame-clamped) delta in seconds — never a raw unclamped `dt`, never a tick count.
 */
export function stepCamera(state: CameraState, dt: number): void {
  const zoomRate =
    state.targetZoom > state.zoom ? ZOOM_IN_SMOOTHING : ZOOM_SMOOTHING;
  const zoomFactor = 1 - Math.exp(-zoomRate * dt);
  state.zoom = state.zoom + (state.targetZoom - state.zoom) * zoomFactor;
  if (Math.abs(state.zoom - state.targetZoom) < 0.001)
    state.zoom = state.targetZoom;

  const panFactor = 1 - Math.exp(-ZOOM_SMOOTHING * dt);
  state.originX =
    state.originX + (state.targetOriginX - state.originX) * panFactor;
  state.originY =
    state.originY + (state.targetOriginY - state.originY) * panFactor;
  if (Math.abs(state.originX - state.targetOriginX) < 0.01)
    state.originX = state.targetOriginX;
  if (Math.abs(state.originY - state.targetOriginY) < 0.01)
    state.originY = state.targetOriginY;

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
 *  never read back into simulation state, per docs/GAME.md §4. */
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
