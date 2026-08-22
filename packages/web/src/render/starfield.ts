/**
 * Deterministic parallax starfield, anchored to WORLD-space coordinates so that scaling/panning the
 * scene (the fitted camera rect resizing as tracked bodies move) reads as the camera moving through
 * a fixed sky, not as the sky itself drifting — see notes/T-05-FLYWHEEL follow-up (view-scaling
 * background rework): the old viewport-normalized, player-offset-driven field visibly fought the
 * player's sense of orientation whenever the camera rescaled.
 *
 * Each star has a FIXED position within a tile of size `tileWidth x tileHeight` (the padded fit
 * rect captured once per attempt, `RenderFrame.backgroundFit` — see `game/camera.ts`'s
 * `baseFitWidth/Height`), tiled infinitely via wrapping. Every layer shares the scene's `zoom`, but
 * each has its own `pan` fraction of the viewpoint (the camera's `x, y` — which IS the fit rect's
 * center, i.e. "where the scene is currently centered") it tracks:
 *   - `pan === 1` (the furthest layer): rigidly locked to the viewpoint, exactly like any world
 *     object — it only ever moves because the SCENE moved (rect re-centered/rescaled), never
 *     because of player motion alone.
 *   - `pan < 1` (nearer layers): lag behind the viewpoint's pan by that fraction, producing a mild
 *     depth cue without breaking the "only moves when the scene moves" invariant.
 * There is deliberately no player-position term anywhere in this file any more.
 *
 * Positions are generated once, from a fixed seed, in tile-normalized [-0.5, 0.5) space, so the
 * field never shimmers between frames or resizes (it's cosmetic and outside the physics-determinism
 * contract — docs/GAME.md §4 "Determinism": rendering may diverge).
 *
 * Perf: stars are grouped into a handful of colour "shades" per layer AT BUILD TIME (not every
 * frame), so `drawStarfield` does one `beginPath`/`fill` per shade instead of one per star —
 * measured to matter: headless-Chromium profiling during T-04 AURORA showed ~190 individual
 * arc+fill star calls contributing measurably to per-frame cost (see notes/T-04-AURORA/log.md).
 * Continuous per-star colour variation is approximated by a small fixed palette (SHADES_PER_LAYER)
 * instead — visually indistinguishable at a 1-4px star size.
 */

import type { Viewport } from "./transform";

export interface Star {
  /** Tile-normalized position in [-0.5, 0.5), independent of tile size. */
  nx: number;
  ny: number;
  size: number;
}

interface StarShadeGroup {
  color: string;
  stars: Star[];
}

export interface StarLayer {
  /** Fraction of the viewpoint's pan this layer follows. 1 = rigidly locked to the scene (the
   *  furthest layer); smaller values lag behind, for a mild depth cue. */
  pan: number;
  groups: StarShadeGroup[];
}

/** World-space viewpoint for one frame: `x, y` is the fit rect's center (where the scene is
 *  currently centered — NOT the player position), `zoom` is the scene's current zoom. Shared with
 *  `RenderFrame.camera`. */
export interface BackgroundViewpoint {
  x: number;
  y: number;
  zoom: number;
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

/** Per-layer pan fraction, furthest (index 0, rigidly locked) to nearest. See module doc comment. */
const PAN_FACTORS: readonly number[] = [1.0, 0.55, 0.3];

/** Fallback tile size (world units) for callers with no fit rect of their own (the dev harness,
 *  the level editor) — arbitrary but roughly level-scale. */
export const DEFAULT_TILE_WIDTH = 2200;
export const DEFAULT_TILE_HEIGHT = 1600;

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
        nx: rng() - 0.5,
        ny: rng() - 0.5,
        size: sizeMin + rng() * (sizeMax - sizeMin),
      });
    }
    layers.push({ pan: PAN_FACTORS[layerIndex] ?? 1.0, groups });
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
 * Draws the background gradient wash + starfield.
 *
 * `viewpoint` is the scene's current `{x, y, zoom}` (the fit rect's center and zoom — same values
 * as `RenderFrame.camera`). `tileWidth/Height` is the world-space tile each star's `nx, ny` is
 * scaled into before wrapping (pass `RenderFrame.backgroundFit`, or `DEFAULT_TILE_WIDTH/HEIGHT`
 * where there is no fit rect).
 */
export function drawStarfield(
  ctx: CanvasRenderingContext2D,
  layers: readonly StarLayer[],
  viewport: Viewport,
  viewpoint: BackgroundViewpoint,
  tileWidth: number,
  tileHeight: number,
): void {
  const w = viewport.width;
  const h = viewport.height;
  const halfW = w * 0.5;
  const halfH = h * 0.5;
  const zoom = viewpoint.zoom > 0 ? viewpoint.zoom : 1;

  ctx.fillStyle = "rgba(5,8,18,1)";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(13,28,51,0.22)";
  ctx.fillRect(0, 0, w, h);

  for (const layer of layers) {
    const panX = viewpoint.x * layer.pan;
    const panY = viewpoint.y * layer.pan;
    for (const group of layer.groups) {
      if (group.stars.length === 0) continue;
      ctx.beginPath();
      for (const star of group.stars) {
        const worldX = star.nx * tileWidth;
        const worldY = star.ny * tileHeight;
        const dx = wrapf(worldX - panX, -tileWidth / 2, tileWidth / 2);
        const dy = wrapf(worldY - panY, -tileHeight / 2, tileHeight / 2);
        const x = halfW + dx * zoom;
        const y = halfH + dy * zoom;
        const size = star.size * zoom;
        ctx.moveTo(x + size, y);
        ctx.arc(x, y, size, 0, Math.PI * 2);
      }
      ctx.fillStyle = group.color;
      ctx.fill();
    }
  }

  // Two soft ambient glows — GameWorld.gd:738-741 layers 3 overlapping flat circles per glow to
  // fake a radial falloff; a single gradient-filled circle gives the same look for roughly a
  // third of the fill cost (no redundant overpaint of the inner radii). Anchored to the viewport,
  // not the scene — purely decorative vignetting, not part of the orientation-bearing starfield.
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
