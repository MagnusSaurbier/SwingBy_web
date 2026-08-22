/**
 * Pan/zoom camera control for the editor's own canvas.
 *
 * This is a SEPARATE camera from gameplay's (`game/camera.ts`'s auto-zoom-to-fit-the-player
 * camera) — the editor has no player to follow, and the user drives pan/zoom by hand. The shape is
 * the same `{x, y, zoom}` as the renderer's `Camera` (docs/INTERFACES.md), which is what lets it be
 * handed straight to `renderer.draw()`/`renderer.worldToScreen()`/`renderer.screenToWorld()`
 * unchanged.
 *
 * Pan/zoom math here is a deliberate, minimal, independent copy of the renderer's own two-line
 * transform formula (`screen = viewportCenter + (world - camera) * zoom`) — NOT a dependency on a
 * real `Renderer` instance, so this module's own tests run with no canvas/fake-canvas at all. This
 * is intentionally narrow: HIT-TESTING (picking which object a click landed on) does NOT use this
 * module's formula — it calls the real `renderer.worldToScreen`/`screenToWorld` from `render/
 * index.ts` (see `editor.ts`), exactly as docs/INTERFACES.md requires ("Hit-testing uses
 * worldToScreen/screenToWorld... rely on that as exact inverses"). Camera pan/zoom bookkeeping is a
 * different concern (where the camera ends up, not which object a point hits) and duplicating a
 * two-line arithmetic formula for that carries no drift risk worth avoiding the testability for.
 *
 * Zoom clamp `[0.12, 5.0]` and the `1.1^steps` wheel-step formula (`editor_zoom_at_screen` in the
 * original game) are editor-only UX constants, not physics, kept as-is to preserve the feel.
 */

export interface EditorCamera {
  x: number;
  y: number;
  zoom: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.12;
export const MAX_ZOOM = 5.0;
const WHEEL_STEP_BASE = 1.1;

export function createEditorCamera(
  x: number,
  y: number,
  zoom = 1,
): EditorCamera {
  return { x, y, zoom: clampZoom(zoom) };
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Same two-line formula as `render/transform.ts`'s `worldToScreenXY` — see module doc comment for
 *  why this is an intentional, narrow, non-hit-testing-facing duplicate. */
export function projectWorldToScreen(
  worldX: number,
  worldY: number,
  camera: EditorCamera,
  viewport: ViewportSize,
): { x: number; y: number } {
  return {
    x: viewport.width * 0.5 + (worldX - camera.x) * camera.zoom,
    y: viewport.height * 0.5 + (worldY - camera.y) * camera.zoom,
  };
}

export function projectScreenToWorld(
  screenX: number,
  screenY: number,
  camera: EditorCamera,
  viewport: ViewportSize,
): { x: number; y: number } {
  const z = camera.zoom > 0.0001 ? camera.zoom : 0.0001;
  return {
    x: camera.x + (screenX - viewport.width * 0.5) / z,
    y: camera.y + (screenY - viewport.height * 0.5) / z,
  };
}

/** Drag-to-pan: moving the mouse by `deltaScreen` px should keep the world point under the cursor
 *  glued to the cursor, i.e. the camera moves the OPPOSITE way in world units. Mirrors
 *  `editor_apply_pan_screen_delta` (GameWorld.gd:490-492). Mutates `camera` in place. */
export function panByScreenDelta(
  camera: EditorCamera,
  deltaScreenX: number,
  deltaScreenY: number,
): void {
  const z = camera.zoom > 0.0001 ? camera.zoom : 0.0001;
  camera.x -= deltaScreenX / z;
  camera.y -= deltaScreenY / z;
}

/** Zoom by `wheelSteps` (positive = zoom in), keeping the world point currently under `screenPos`
 *  fixed on screen. Mirrors `editor_zoom_at_screen` (GameWorld.gd:496-505). Mutates `camera` in
 *  place. */
export function zoomAtScreenPoint(
  camera: EditorCamera,
  wheelSteps: number,
  screenPos: { x: number; y: number },
  viewport: ViewportSize,
): void {
  const worldAtCursor = projectScreenToWorld(
    screenPos.x,
    screenPos.y,
    camera,
    viewport,
  );
  const factor = WHEEL_STEP_BASE ** wheelSteps;
  camera.zoom = clampZoom(camera.zoom * factor);
  const newScreen = projectWorldToScreen(
    worldAtCursor.x,
    worldAtCursor.y,
    camera,
    viewport,
  );
  // Correct the camera so the same world point lands back under the cursor after the zoom change.
  const z = camera.zoom;
  camera.x += (newScreen.x - screenPos.x) / z;
  camera.y += (newScreen.y - screenPos.y) / z;
}

/** Bounding-box-fit camera for an initial view of a set of world points, with generous margin so
 *  freshly placed objects near the edge aren't clipped. Falls back to a level-sized default view
 *  centred on the world span's rough middle (see docs/GAME.md §4: world spans ~0-2600 x 0-1800) when
 *  given zero points (a brand-new empty level). */
export function fitCamera(
  points: ReadonlyArray<{ x: number; y: number }>,
  viewport: ViewportSize,
): EditorCamera {
  if (points.length === 0) {
    return createEditorCamera(1300, 900, 0.5);
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
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const spanX = Math.max(200, maxX - minX);
  const spanY = Math.max(200, maxY - minY);
  const margin = 1.4;
  const zoomX = viewport.width / (spanX * margin);
  const zoomY = viewport.height / (spanY * margin);
  return createEditorCamera(cx, cy, clampZoom(Math.min(zoomX, zoomY)));
}
