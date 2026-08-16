/**
 * Goal ring, force vector, bounds-warning edge glow, and reset flash. Ported from
 * reference/godot/scripts/GameWorld.gd:
 *   - `_draw_goal_ring`        :765-774
 *   - `_draw_force_vector`     :845-855
 *   - `_draw_bounds_warning`   :777-792
 *   - `_draw_reset_flash`      :795-800
 *
 * Godot drives the goal-ring pulse and the bounds-warning pulse off `_goal_flash`, a free-running
 * `elapsed_time`-independent clock (`_goal_flash += delta` every process frame, GameWorld.gd:441 —
 * note it is NOT reset by level restarts, only ever increases). `RenderFrame` carries no clock
 * field (by design — a clock is not simulation state), so these two functions take a
 * `clockSeconds` argument that index.ts supplies from `performance.now()/1000`. That is the one
 * intentional exception to "pure function of the frame": it is wall-clock cosmetic animation, not
 * anything derived from `world`/`trail`/`prediction`, exactly mirroring what `_goal_flash` already
 * is in the reference. See notes/T-04-AURORA/log.md.
 */

import { BOUNDS_WARNING_BORDER, COLORS } from "@swingby/core/constants";
import { clampZoom, type Viewport } from "./transform";

function rgba(
  c: readonly [number, number, number, number],
  alphaMul = 1,
): string {
  return `rgba(${c[0] * 255}, ${c[1] * 255}, ${c[2] * 255}, ${c[3] * alphaMul})`;
}

export function drawGoalRing(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  goalRangeWorld: number,
  zoom: number,
  clockSeconds: number,
): void {
  const z = clampZoom(zoom);
  const pulse = 1 + Math.sin(clockSeconds * 3) * 0.08;
  const radius = goalRangeWorld * z * pulse;
  if (radius <= 0) return;

  ctx.strokeStyle = rgba(COLORS.goal);
  ctx.lineWidth = Math.max(2, 3 * z);
  ctx.beginPath();
  ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = rgba(COLORS.goal, 0.2 / COLORS.goal[3]);
  ctx.beginPath();
  ctx.arc(screenX, screenY, radius * 0.14, 0, Math.PI * 2);
  ctx.fill();
}

const FORCE_VECTOR_SCALE = 2200;
const FORCE_VECTOR_MIN_LENGTH = 0.5;

export function drawForceVector(
  ctx: CanvasRenderingContext2D,
  originScreenX: number,
  originScreenY: number,
  forceWorldX: number,
  forceWorldY: number,
  zoom: number,
): void {
  const z = clampZoom(zoom);
  const dx = forceWorldX * FORCE_VECTOR_SCALE * z;
  const dy = forceWorldY * FORCE_VECTOR_SCALE * z;
  if (Math.hypot(dx, dy) < FORCE_VECTOR_MIN_LENGTH) return;

  const destX = originScreenX + dx;
  const destY = originScreenY + dy;

  ctx.strokeStyle = "rgba(230, 250, 255, 0.75)";
  ctx.lineWidth = Math.max(1, 2 * z);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(originScreenX, originScreenY);
  ctx.lineTo(destX, destY);
  ctx.stroke();

  ctx.fillStyle = "rgba(230, 250, 255, 0.9)";
  ctx.beginPath();
  ctx.arc(destX, destY, 3, 0, Math.PI * 2);
  ctx.fill();
}

export function drawBoundsWarning(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  intensity: number,
  clockSeconds: number,
): void {
  if (intensity <= 0) return;
  const clamped = intensity > 1 ? 1 : intensity;
  const pulseSpeed = 2 + clamped * 5;
  const pulse = 0.55 + 0.45 * Math.sin(clockSeconds * pulseSpeed);
  const alpha = clampAlpha(
    0.08 + clamped * 0.36 + pulse * 0.14 * clamped,
    0.78,
  );
  const glowAlpha = clampAlpha(alpha * 0.52, 0.36);

  ctx.strokeStyle = `rgba(255, 31, 20, ${glowAlpha})`;
  ctx.lineWidth = BOUNDS_WARNING_BORDER * 2;
  ctx.strokeRect(0, 0, viewport.width, viewport.height);

  ctx.strokeStyle = `rgba(255, 41, 31, ${alpha})`;
  ctx.lineWidth = BOUNDS_WARNING_BORDER;
  ctx.strokeRect(0, 0, viewport.width, viewport.height);
}

function clampAlpha(v: number, max: number): number {
  if (v < 0) return 0;
  return v > max ? max : v;
}

export function drawResetFlash(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  flash: number,
): void {
  if (flash <= 0) return;
  const clamped = flash > 1 ? 1 : flash;
  ctx.fillStyle = `rgba(255, 20, 15, ${0.42 * clamped})`;
  ctx.fillRect(0, 0, viewport.width, viewport.height);
}
