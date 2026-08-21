/**
 * Trajectory-prediction overlay. Up to ~1000 sample points for the player, plus one track per
 * planet — drawing one `draw_circle`-equivalent call per point would be hundreds of draw calls,
 * so instead this builds a single path (one `beginPath`/`fill` per group) out of per-point
 * `moveTo`+`arc` pairs, costing two fill() calls total. (Deliberately not using the real `Path2D`
 * class: it doesn't exist in the plain-Node test environment this project's unit tests run under
 * — see notes/archive/T-04-AURORA/log.md — and `ctx.beginPath()`/`fill()` achieve the same
 * single-fill-call result while staying inside the fakeable `CanvasRenderingContext2D` surface.)
 *
 * Radii: player dots `max(1.25, 1.8*zoom)`, planet dots `max(1.0, 1.5*zoom)`.
 */

import { COLORS } from "@swingby/core/constants";
import type { Prediction } from "@swingby/core/types";
import { clampZoom, type Viewport } from "./transform";

function rgba(c: readonly [number, number, number, number]): string {
  return `rgba(${c[0] * 255}, ${c[1] * 255}, ${c[2] * 255}, ${c[3]})`;
}

export function drawPrediction(
  ctx: CanvasRenderingContext2D,
  prediction: Prediction,
  cameraX: number,
  cameraY: number,
  zoom: number,
  viewport: Viewport,
): void {
  const z = clampZoom(zoom);
  const halfW = viewport.width * 0.5;
  const halfH = viewport.height * 0.5;
  const playerRadius = Math.max(1.25, 1.8 * z);
  const planetRadius = Math.max(1.0, 1.5 * z);

  if (prediction.player.length > 0) {
    ctx.beginPath();
    for (let i = 0; i < prediction.player.length; i++) {
      const p = prediction.player[i]!;
      const sx = halfW + (p.x - cameraX) * z;
      const sy = halfH + (p.y - cameraY) * z;
      ctx.moveTo(sx + playerRadius, sy);
      ctx.arc(sx, sy, playerRadius, 0, Math.PI * 2);
    }
    ctx.fillStyle = rgba(COLORS.predictionPlayer);
    ctx.fill();
  }

  let hasPlanetPoints = false;
  for (const track of prediction.planets) {
    if (track.length > 0) {
      hasPlanetPoints = true;
      break;
    }
  }
  if (hasPlanetPoints) {
    ctx.beginPath();
    for (const track of prediction.planets) {
      for (let i = 0; i < track.length; i++) {
        const p = track[i]!;
        const sx = halfW + (p.x - cameraX) * z;
        const sy = halfH + (p.y - cameraY) * z;
        ctx.moveTo(sx + planetRadius, sy);
        ctx.arc(sx, sy, planetRadius, 0, Math.PI * 2);
      }
    }
    ctx.fillStyle = rgba(COLORS.predictionPlanet);
    ctx.fill();
  }
}
