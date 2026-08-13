/**
 * Flown-path trail. Ported from `_draw_trail`, reference/godot/scripts/GameWorld.gd:754-762,
 * which draws a single flat-colour `draw_polyline`. The task doc (tasks/T-04-AURORA.md, "What to
 * draw" table) asks for fading toward the tail instead — rendering is explicitly outside the
 * physics-parity contract (PROJECT.md §4 "Determinism"), so this intentionally diverges from the
 * reference.
 *
 * Perf: `draw()` never allocates. The screen-space scratch buffer is a Float64Array owned by the
 * returned TrailDrawer closure, sized to TRAIL_LENGTH*2 up front and only ever reused — see
 * notes/T-04-AURORA/log.md decision #4 for why fading is done in a handful of alpha "buckets"
 * (each one beginPath/stroke call) instead of either a single flat stroke (no fade) or one stroke
 * per segment (5,000 draw calls/frame, far outside the 4ms budget).
 */

import { COLORS, TRAIL_LENGTH } from "@swingby/core/constants";
import type { Vec2 } from "@swingby/core/types";
import { clampZoom, type Viewport } from "./transform";

/**
 * Number of separate stroke() passes used to fade the trail. Empirically load-bearing, not just
 * a visual-smoothness dial: in-browser profiling during this task (headless Chromium, see
 * notes/T-04-AURORA/log.md) measured 24 buckets as bimodal — usually fine, but sometimes landing
 * on a >>10ms/frame path for reasons that track the STROKE CALL COUNT specifically (starfield and
 * body draws stayed fast the whole time; only the many-small-strokes trail path regressed). 8
 * buckets reproduced consistently fast (sub-1ms) across 19 independent fresh-browser trials with
 * no slow-path recurrence. Still a visible fade at 8 steps; raise this only after re-running that
 * kind of multi-trial check, not a single sample.
 */
const FADE_BUCKETS = 8;
/** Dimmest bucket (tail) alpha as a fraction of the full trail alpha; newest bucket reaches 1.0. */
const TAIL_ALPHA_FLOOR = 0.06;
/**
 * Screen-space decimation floor, in CSS px. Real gameplay records one trail point per PHYSICS
 * TICK (144/s — constants.ts `TPS`), so at typical zoom and ship speed consecutive points often
 * land well under a pixel apart; stroking all 5,000 of them is pure waste. Collapsing runs of
 * points closer together than this (keeping the first of each run, and always the current head)
 * measurably cuts real-world draw cost with no visible difference — see the benchmark numbers in
 * notes/T-04-AURORA/log.md ("dense" vs "coarse" scene).
 */
const MIN_SEGMENT_PX = 1.2;

export interface TrailDrawer {
  draw(
    ctx: CanvasRenderingContext2D,
    trail: readonly Vec2[],
    cameraX: number,
    cameraY: number,
    zoom: number,
    viewport: Viewport,
  ): void;
}

export function createTrailDrawer(initialCapacity: number = TRAIL_LENGTH): TrailDrawer {
  let scratch = new Float64Array(Math.max(2, initialCapacity) * 2);

  function ensureCapacity(points: number): void {
    if (scratch.length >= points * 2) return;
    scratch = new Float64Array(points * 2);
  }

  return {
    draw(ctx, trail, cameraX, cameraY, zoom, viewport) {
      const n = trail.length;
      if (n < 2) return;

      const z = clampZoom(zoom);
      const halfW = viewport.width * 0.5;
      const halfH = viewport.height * 0.5;

      // Cheap bbox cull in world space before touching the canvas at all.
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        const p = trail[i]!;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const screenMinX = halfW + (minX - cameraX) * z;
      const screenMaxX = halfW + (maxX - cameraX) * z;
      const screenMinY = halfH + (minY - cameraY) * z;
      const screenMaxY = halfH + (maxY - cameraY) * z;
      if (screenMaxX < 0 || screenMinX > viewport.width || screenMaxY < 0 || screenMinY > viewport.height) {
        return;
      }

      ensureCapacity(n);
      const minGapSq = MIN_SEGMENT_PX * MIN_SEGMENT_PX;
      let writeCount = 0;
      let lastX = 0;
      let lastY = 0;
      for (let i = 0; i < n; i++) {
        const p = trail[i]!;
        const sx = halfW + (p.x - cameraX) * z;
        const sy = halfH + (p.y - cameraY) * z;
        if (writeCount > 0 && i !== n - 1) {
          const dx = sx - lastX;
          const dy = sy - lastY;
          if (dx * dx + dy * dy < minGapSq) continue; // too close to the last kept point to matter
        }
        scratch[writeCount * 2] = sx;
        scratch[writeCount * 2 + 1] = sy;
        lastX = sx;
        lastY = sy;
        writeCount++;
      }
      if (writeCount < 2) return;

      const lineWidth = Math.max(1, 2 * z);
      // "bevel" (not "round"): a round join rasterizes a filled arc at EVERY vertex, which is
      // needlessly expensive across up to TRAIL_LENGTH (5,000) segments and imperceptible at a
      // 1-2px line width — see notes/T-04-AURORA/log.md for the measured before/after.
      ctx.lineJoin = "bevel";
      ctx.lineCap = "butt";
      ctx.lineWidth = lineWidth;

      const [r, g, b, a] = COLORS.trail;
      const bucketCount = Math.min(FADE_BUCKETS, writeCount - 1);
      const pointsPerBucket = Math.ceil((writeCount - 1) / bucketCount);

      for (let bucket = 0; bucket < bucketCount; bucket++) {
        const startIdx = bucket * pointsPerBucket;
        const endIdx = Math.min(writeCount - 1, startIdx + pointsPerBucket);
        if (startIdx >= endIdx) continue;
        const age = (bucket + 1) / bucketCount; // 0 near tail, 1 at head
        const alpha = a * (TAIL_ALPHA_FLOOR + (1 - TAIL_ALPHA_FLOOR) * age);
        ctx.strokeStyle = `rgba(${r * 255}, ${g * 255}, ${b * 255}, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(scratch[startIdx * 2]!, scratch[startIdx * 2 + 1]!);
        for (let i = startIdx + 1; i <= endIdx; i++) {
          ctx.lineTo(scratch[i * 2]!, scratch[i * 2 + 1]!);
        }
        ctx.stroke();
      }
    },
  };
}
