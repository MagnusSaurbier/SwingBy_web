/**
 * Draws suns, planets and the player ship. Ported from `_draw_objects` in
 * reference/godot/scripts/GameWorld.gd:803-836.
 *
 * Rotation: `Body.angle` (types.ts) is already the final visual rotation in radians — for the
 * player it was set by physics from `velocity.angle() + PI/2`
 * (reference/godot/scripts/PhysicsEngine.gd:215-218, applied in GameWorld.gd:551), for planets
 * from accumulated `turnSpeed`. This module never recomputes it from velocity — it just reads
 * `body.angle`, same as Godot's own `_draw_objects` (GameWorld.gd:821, :830 both read
 * `obj["angle"]`, they do not call `rocket_angle_from_velocity` again at draw time). That keeps
 * this module a pure function of the frame, per rule #6 (stateless w.r.t. gameplay).
 */

import { COLORS, ROCKET_SCALE } from "@swingby/core/constants";
import type { Body } from "@swingby/core/types";
import { clampZoom } from "./transform";
import type { SpriteSet } from "./sprites";

function rgba(c: readonly [number, number, number, number], alphaMul = 1): string {
  return `rgba(${c[0] * 255}, ${c[1] * 255}, ${c[2] * 255}, ${c[3] * alphaMul})`;
}

/** Sun: halo + mid ring + core. Invisible suns must not call this at all — see index.ts. */
export function drawSun(ctx: CanvasRenderingContext2D, screenX: number, screenY: number, worldRadius: number, zoom: number): void {
  const radius = worldRadius * clampZoom(zoom);
  ctx.fillStyle = rgba(COLORS.sunHalo);
  ctx.beginPath();
  ctx.arc(screenX, screenY, radius * 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 199, 71, 0.28)";
  ctx.beginPath();
  ctx.arc(screenX, screenY, radius * 1.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = rgba(COLORS.sunCore);
  ctx.beginPath();
  ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Planet: procedural shaded sphere (no earth.png — see notes/T-04-AURORA/log.md decision #1;
 * only the rocket sprites are in this task's copy list) with a rotating equator band driven by
 * `angle` so spin is visually verifiable, same intent as Godot's rotated earth texture.
 */
export function drawPlanet(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  worldSize: number,
  angle: number,
  zoom: number,
): void {
  const radius = Math.max(6, worldSize * 2.3 * clampZoom(zoom));

  ctx.fillStyle = "rgba(56, 128, 214, 0.18)";
  ctx.beginPath();
  ctx.arc(screenX, screenY, radius * 0.82, 0, Math.PI * 2);
  ctx.fill();

  const gradient = ctx.createRadialGradient(
    screenX - radius * 0.35,
    screenY - radius * 0.35,
    Math.max(0.01, radius * 0.05),
    screenX,
    screenY,
    radius,
  );
  gradient.addColorStop(0, "rgba(196, 228, 255, 0.96)");
  gradient.addColorStop(0.55, "rgba(78, 150, 222, 0.96)");
  gradient.addColorStop(1, "rgba(18, 42, 88, 0.96)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(screenX, screenY);
  ctx.rotate(angle);
  ctx.scale(1, 0.36);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.lineWidth = Math.max(1, radius * 0.05);
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

const FALLBACK_HALF_WIDTH = 42;
const FALLBACK_HEIGHT = 232;

/** Used only while the real sprite hasn't finished loading (or in a DOM-less test environment). */
function drawFallbackShip(ctx: CanvasRenderingContext2D, isBoosting: boolean): void {
  ctx.fillStyle = "rgba(214, 224, 236, 0.95)";
  ctx.beginPath();
  ctx.moveTo(0, -FALLBACK_HEIGHT * 0.5);
  ctx.lineTo(FALLBACK_HALF_WIDTH, FALLBACK_HEIGHT * 0.42);
  ctx.lineTo(0, FALLBACK_HEIGHT * 0.28);
  ctx.lineTo(-FALLBACK_HALF_WIDTH, FALLBACK_HEIGHT * 0.42);
  ctx.closePath();
  ctx.fill();
  if (isBoosting) {
    ctx.fillStyle = "rgba(255, 176, 64, 0.9)";
    ctx.beginPath();
    ctx.moveTo(-FALLBACK_HALF_WIDTH * 0.4, FALLBACK_HEIGHT * 0.42);
    ctx.lineTo(0, FALLBACK_HEIGHT * 0.75);
    ctx.lineTo(FALLBACK_HALF_WIDTH * 0.4, FALLBACK_HEIGHT * 0.42);
    ctx.closePath();
    ctx.fill();
  }
}

/** Player ship: HUD glow, then the rocket texture (or a fallback silhouette). */
export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  sprites: SpriteSet,
  screenX: number,
  screenY: number,
  body: Pick<Body, "angle" | "boostType" | "isBoosting">,
  zoom: number,
): void {
  const scaleFactor = ROCKET_SCALE * zoom;

  ctx.fillStyle = rgba(COLORS.hudGlow);
  ctx.beginPath();
  ctx.arc(screenX, screenY, 44 * scaleFactor, 0, Math.PI * 2);
  ctx.fill();

  const img = sprites.get(body.boostType, body.isBoosting);

  ctx.save();
  ctx.translate(screenX, screenY);
  ctx.rotate(body.angle);
  ctx.scale(scaleFactor, scaleFactor);
  if (img) {
    ctx.drawImage(img, -img.naturalWidth * 0.5, -img.naturalHeight * 0.5);
  } else {
    drawFallbackShip(ctx, body.isBoosting);
  }
  ctx.restore();
}
