/**
 * Canvas renderer. Signatures match docs/INTERFACES.md "web/render/index.ts" exactly; do not
 * change this file's public surface without updating that doc and its consumers (the game loop,
 * the editor).
 *
 * The renderer is a pure function of the `RenderFrame` it is handed each `draw()` call (rule #6:
 * "stateless with respect to gameplay" — it owns no simulation state and never advances anything,
 * and must tolerate `world` mutating between frames). The only state this module keeps across
 * frames is presentation infrastructure that is NOT derived from `world`/`trail`/`prediction`:
 *   - the canvas 2D context and current viewport size (from `resize()`)
 *   - the starfield (generated once from a fixed seed — see starfield.ts)
 *   - the sprite cache (loaded once, async — see sprites.ts)
 *   - reusable scratch buffers for the trail (see trail.ts)
 *   - a wall-clock cosmetic pulse for the goal ring / bounds warning, free-running independent of
 *     simulation state (see overlays.ts's doc comment)
 * None of that is gameplay state: two renderers handed the same frame draw the same pixels
 * (module-for-module) regardless of prior frames, and nothing here is ever read back into a
 * gameplay decision.
 *
 * Draw order: background -> predictions -> trail -> goal ring -> bodies -> force vector ->
 * bounds warning -> reset flash. There is no exhaust-particle step (no field for it in
 * `RenderFrame`) and no editor-overlay drawing here: `editorOverlay` is explicitly opaque to this
 * renderer (docs/INTERFACES.md — "pass it through untouched; do not interpret it").
 */

import type { Prediction, Vec2, World } from "@swingby/core/types";
import { drawPlanet, drawPlayer, drawSun } from "./bodies";
import {
  drawBoundsWarning,
  drawForceVector,
  drawGoalRing,
  drawResetFlash,
} from "./overlays";
import { drawPrediction } from "./prediction";
import { createSpriteSet, type SpriteSet } from "./sprites";
import {
  buildStarfield,
  DEFAULT_TILE_HEIGHT,
  DEFAULT_TILE_WIDTH,
  drawStarfield,
  type StarLayer,
} from "./starfield";
import { createTrailDrawer, type TrailDrawer } from "./trail";
import {
  clampZoom,
  screenToWorldXY,
  worldToScreenXY,
  type Viewport,
} from "./transform";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface RenderFrame {
  world: World;
  camera: Camera;
  trail: readonly Vec2[];
  prediction: Prediction | null;
  forceVector: Vec2 | null;
  boundsWarning: number; // 0-1, drives the edge glow
  flash: number; // 0-1, reset flash
  showTrail: boolean;
  /** World-space size of the background starfield's wrap tile — pass the fit rect the camera is
   *  currently tracking (`game/camera.ts`'s `baseFitWidth/Height`) so the furthest starfield layer
   *  lines up with the scene's own scale. Optional: callers with no fit rect of their own (the dev
   *  harness, the editor) fall back to a fixed default — see `render/starfield.ts`. */
  backgroundFit?: { width: number; height: number };
  editorOverlay?: unknown; // opaque to the renderer; the editor module defines it
}

export interface Renderer {
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  draw(frame: RenderFrame): void;
  /** World<->screen for hit-testing. Used by the editor. */
  worldToScreen(p: Vec2, camera: Camera): Vec2;
  screenToWorld(p: Vec2, camera: Camera): Vec2;
}

function nowSeconds(): number {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now() / 1000;
  }
  return Date.now() / 1000;
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("createRenderer: canvas 2D context unavailable");
  }

  const viewport: Viewport = {
    width: canvas.width || 300,
    height: canvas.height || 150,
  };

  const starLayers: StarLayer[] = buildStarfield();
  const sprites: SpriteSet = createSpriteSet();
  const trailDrawer: TrailDrawer = createTrailDrawer();

  const resize = (cssWidth: number, cssHeight: number, dpr: number): void => {
    const safeDpr = dpr > 0 ? dpr : 1;
    const backingWidth = Math.max(1, Math.round(cssWidth * safeDpr));
    const backingHeight = Math.max(1, Math.round(cssHeight * safeDpr));
    canvas.width = backingWidth;
    canvas.height = backingHeight;
    if (canvas.style) {
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
    }
    // devicePixelRatio handled here, once, so draw() always works in CSS-pixel units — never
    // scale inside draw() itself (that's what produces a blurry canvas on retina displays).
    ctx.setTransform(safeDpr, 0, 0, safeDpr, 0, 0);
    viewport.width = cssWidth;
    viewport.height = cssHeight;
  };

  const draw = (frame: RenderFrame): void => {
    const {
      world,
      camera,
      trail,
      prediction,
      forceVector,
      boundsWarning,
      flash,
      showTrail,
      backgroundFit,
    } = frame;
    const bodies = world.bodies;
    const zoom = clampZoom(camera.zoom);
    const halfW = viewport.width * 0.5;
    const halfH = viewport.height * 0.5;
    const clockSeconds = nowSeconds();

    const player = bodies[world.playerIndex];

    drawStarfield(
      ctx,
      starLayers,
      viewport,
      { x: camera.x, y: camera.y, zoom },
      backgroundFit?.width ?? DEFAULT_TILE_WIDTH,
      backgroundFit?.height ?? DEFAULT_TILE_HEIGHT,
    );

    if (prediction) {
      drawPrediction(ctx, prediction, camera.x, camera.y, zoom, viewport);
    }

    if (showTrail) {
      trailDrawer.draw(ctx, trail, camera.x, camera.y, zoom, viewport);
    }

    const goalBody = bodies[world.goalIndex];
    if (goalBody) {
      const gsx = halfW + (goalBody.x - camera.x) * zoom;
      const gsy = halfH + (goalBody.y - camera.y) * zoom;
      drawGoalRing(ctx, gsx, gsy, world.goalRange, zoom, clockSeconds);
    }

    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i]!;
      const sx = halfW + (body.x - camera.x) * zoom;
      const sy = halfH + (body.y - camera.y) * zoom;
      switch (body.type) {
        case "sun":
          // Invisible suns still gravitate (physics concern) but are genuinely never drawn —
          // GameWorld.gd:811 `if bool(obj.get("visible", true))`. This is a gameplay mechanic
          // (hidden gravity sources), not an optimization; do not "helpfully" draw them faintly.
          if (body.visible) {
            drawSun(ctx, sx, sy, body.size, zoom);
          }
          break;
        case "planet":
          drawPlanet(ctx, sx, sy, body.size, body.angle, zoom);
          break;
        case "player":
          drawPlayer(ctx, sprites, sx, sy, body, zoom);
          break;
      }
    }

    if (forceVector && player) {
      const psx = halfW + (player.x - camera.x) * zoom;
      const psy = halfH + (player.y - camera.y) * zoom;
      drawForceVector(ctx, psx, psy, forceVector.x, forceVector.y, zoom);
    }

    drawBoundsWarning(ctx, viewport, boundsWarning, clockSeconds);
    drawResetFlash(ctx, viewport, flash);
    // frame.editorOverlay is intentionally never read — opaque to this renderer (rule #10).
  };

  return {
    resize,
    draw,
    worldToScreen(p: Vec2, camera: Camera): Vec2 {
      return worldToScreenXY(
        p.x,
        p.y,
        camera.x,
        camera.y,
        camera.zoom,
        viewport,
      );
    },
    screenToWorld(p: Vec2, camera: Camera): Vec2 {
      return screenToWorldXY(
        p.x,
        p.y,
        camera.x,
        camera.y,
        camera.zoom,
        viewport,
      );
    },
  };
}
