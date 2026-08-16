/**
 * Deterministic parallax starfield. Ported from `_build_starfield` / the star-drawing half of
 * `_draw_background` in reference/godot/scripts/GameWorld.gd:719-741, 858-872.
 *
 * Godot builds star positions once in `_ready()` from the engine RNG (wall-clock seeded) against
 * whatever the viewport happened to be at that instant, then wraps them every frame. We have no
 * construction-time viewport guarantee (`resize()` may be called after or before the first
 * `draw()`), and the task explicitly requires the field never shimmer between frames or between
 * runs — so positions are generated once, from a **fixed** seed, in viewport-normalized [0,1]
 * space, and scaled to the actual viewport at draw time. That makes the field reproducible
 * (same seed -> same pixels for a given viewport) and resize-proof, at the cost of not matching
 * Godot's exact star layout — acceptable, this is cosmetic and outside the physics-parity
 * contract (PROJECT.md §4 "Determinism": rendering may diverge).
 *
 * Perf: stars are grouped into a handful of colour "shades" per layer AT BUILD TIME (not every
 * frame), so `drawStarfield` does one `beginPath`/`fill` per shade instead of one per star —
 * measured to matter: headless-Chromium profiling during this task showed ~190 individual
 * arc+fill star calls contributing measurably to per-frame cost (see
 * notes/T-04-AURORA/log.md). Continuous per-star colour variation is approximated by a small
 * fixed palette (SHADES_PER_LAYER) instead — visually indistinguishable at a 1-4px star size.
 */

import type { Viewport } from "./transform";

export interface Star {
  /** Normalized [0,1] position, independent of viewport size. */
  nx: number;
  ny: number;
  size: number;
}

interface StarShadeGroup {
  color: string;
  stars: Star[];
}

export interface StarLayer {
  parallax: number;
  groups: StarShadeGroup[];
}

/** Fixed seed — DO NOT derive from Math.random or wall-clock. Must not shimmer between frames. */
const STARFIELD_SEED = 0x53574259; // "SWBY"

/** mulberry32 — small, fast, deterministic PRNG. Same seed always produces the same sequence. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LAYER_COUNT = 3;
const SHADES_PER_LAYER: number = 4;

export function buildStarfield(seed: number = STARFIELD_SEED): StarLayer[] {
  const rng = mulberry32(seed);
  const layers: StarLayer[] = [];
  for (let layerIndex = 0; layerIndex < LAYER_COUNT; layerIndex++) {
    const starCount = 46 + layerIndex * 18;
    const alpha = 0.25 + layerIndex * 0.14;
    const groups: StarShadeGroup[] = [];
    for (let shade = 0; shade < SHADES_PER_LAYER; shade++) {
      const t = SHADES_PER_LAYER === 1 ? 0 : shade / (SHADES_PER_LAYER - 1);
      const r = (0.72 + t * 0.28) * 255;
      const g = (0.82 + t * 0.18) * 255;
      groups.push({ color: `rgba(${r}, ${g}, 255, ${alpha})`, stars: [] });
    }
    const sizeMin = 0.8 + layerIndex;
    const sizeMax = 1.8 + layerIndex;
    for (let i = 0; i < starCount; i++) {
      const shade = Math.floor(rng() * SHADES_PER_LAYER) % SHADES_PER_LAYER;
      groups[shade]!.stars.push({
        nx: rng(),
        ny: rng(),
        size: sizeMin + rng() * (sizeMax - sizeMin),
      });
    }
    layers.push({ parallax: 0.06 + layerIndex * 0.08, groups });
  }
  return layers;
}

/** Godot's `wrapf`: wraps `value` into [min, max). */
function wrapf(value: number, min: number, max: number): number {
  const range = max - min;
  if (range <= 0) return min;
  const offset = value - min;
  const wrapped = offset - Math.floor(offset / range) * range;
  return min + wrapped;
}

/**
 * Draws the background gradient wash + starfield. `playerOffsetX/Y` is
 * `(player.world - camera.center) * zoom` in screen pixels — the same quantity Godot computes
 * inline in `_draw_background` (GameWorld.gd:724-736) — pass 0,0 if there is no player body.
 */
export function drawStarfield(
  ctx: CanvasRenderingContext2D,
  layers: readonly StarLayer[],
  viewport: Viewport,
  playerOffsetX: number,
  playerOffsetY: number,
): void {
  const w = viewport.width;
  const h = viewport.height;

  ctx.fillStyle = "rgba(5,8,18,1)";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(13,28,51,0.22)";
  ctx.fillRect(0, 0, w, h);

  for (const layer of layers) {
    const px = playerOffsetX * layer.parallax;
    const py = playerOffsetY * layer.parallax;
    for (const group of layer.groups) {
      if (group.stars.length === 0) continue;
      ctx.beginPath();
      for (const star of group.stars) {
        const baseX = star.nx * w;
        const baseY = star.ny * h;
        const x = wrapf(baseX - px, -32, w + 32);
        const y = wrapf(baseY - py, -32, h + 32);
        ctx.moveTo(x + star.size, y);
        ctx.arc(x, y, star.size, 0, Math.PI * 2);
      }
      ctx.fillStyle = group.color;
      ctx.fill();
    }
  }

  // Two soft ambient glows — GameWorld.gd:738-741 layers 3 overlapping flat circles per glow to
  // fake a radial falloff; a single gradient-filled circle gives the same look for roughly a
  // third of the fill cost (no redundant overpaint of the inner radii).
  drawGlow(ctx, w * 0.18, h * 0.12, 820, "rgba(41,128,184,0.1)");
  drawGlow(ctx, w * 0.82, h * 0.24, 574, "rgba(51,89,168,0.075)");
}

function drawGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  colorAtCenter: string,
): void {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, colorAtCenter);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}
