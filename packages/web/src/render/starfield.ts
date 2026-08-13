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
 */

import type { Viewport } from "./transform";

export interface Star {
  /** Normalized [0,1] position, independent of viewport size. */
  nx: number;
  ny: number;
  size: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface StarLayer {
  parallax: number;
  stars: Star[];
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

export function buildStarfield(seed: number = STARFIELD_SEED): StarLayer[] {
  const rng = mulberry32(seed);
  const layers: StarLayer[] = [];
  for (let layerIndex = 0; layerIndex < LAYER_COUNT; layerIndex++) {
    const starCount = 46 + layerIndex * 18;
    const stars: Star[] = [];
    for (let i = 0; i < starCount; i++) {
      const sizeMin = 0.8 + layerIndex;
      const sizeMax = 1.8 + layerIndex;
      stars.push({
        nx: rng(),
        ny: rng(),
        size: sizeMin + rng() * (sizeMax - sizeMin),
        r: 0.72 + rng() * 0.28,
        g: 0.82 + rng() * 0.18,
        b: 1.0,
        a: 0.25 + layerIndex * 0.14,
      });
    }
    layers.push({ parallax: 0.06 + layerIndex * 0.08, stars });
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
    for (const star of layer.stars) {
      const baseX = star.nx * w;
      const baseY = star.ny * h;
      const x = wrapf(baseX - px, -32, w + 32);
      const y = wrapf(baseY - py, -32, h + 32);
      ctx.fillStyle = `rgba(${star.r * 255}, ${star.g * 255}, ${star.b * 255}, ${star.a})`;
      ctx.beginPath();
      ctx.arc(x, y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Two soft ambient glow "stacks", each 3 overlapping translucent circles shrinking outward-in —
  // GameWorld.gd:738-741. The overlap (not a single circle) is what gives the soft radial falloff.
  for (let glowIndex = 0; glowIndex < 3; glowIndex++) {
    const radius = 320 + ((820 - 320) * glowIndex) / 2;
    ctx.fillStyle = "rgba(41,128,184,0.04)";
    ctx.beginPath();
    ctx.arc(w * 0.18, h * 0.12, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(51,89,168,0.03)";
    ctx.beginPath();
    ctx.arc(w * 0.82, h * 0.24, radius * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
}
