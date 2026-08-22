/**
 * Deterministic, infinite parallax starfield, anchored to WORLD-space coordinates so that
 * scaling/panning the scene (the fitted camera rect resizing as tracked bodies move) reads as the
 * camera moving through a fixed sky, not as the sky itself drifting.
 *
 * Stars are generated ON THE FLY from a spatial hash grid — never precomputed into a finite list —
 * so the field has no edge: it covers however large or small a rectangle the camera ends up
 * fitting, with no "you've flown past the edge of the sky" gap. Each layer picks a grid cell size
 * (an integer power of `LOD_RATIO` times `config.baseCellWorld`) so that a cell spans roughly
 * `TARGET_CELL_PX` on screen AT THE CURRENT ZOOM — since the number of on-screen cells is then
 * `~viewport / TARGET_CELL_PX` regardless of zoom, both the star COUNT and their per-star SCREEN
 * SIZE stay roughly constant across zoom levels (the "density stays the same independent of zoom"
 * requirement), and the amount of work done per frame is bounded by viewport size alone — never by
 * how far zoomed in or out the camera is. Crossing a cell-size doubling threshold swaps in a
 * different (finer or coarser) set of stars, which reads as new detail fading in when zooming in
 * and fading out when zooming out — there is no continuous resizing of any individual star's
 * position (that would make "fixed-to-world-coordinates" stars drift as zoom changes).
 *
 * Each layer has its own `pan` fraction of the viewpoint (the camera's `x, y` — which IS the
 * current fit rect's center, i.e. "where the scene is currently centered") it tracks:
 *   - `pan === 1` (the furthest layer): rigidly locked to the viewpoint — it only ever moves
 *     because the SCENE moved (rect re-centered/rescaled), never because of player motion alone.
 *   - `pan < 1` (nearer layers): lag behind the viewpoint's pan by that fraction, producing a mild
 *     depth cue without breaking the "only moves when the scene moves" invariant.
 * There is deliberately no player-position term anywhere in this file.
 *
 * A star's hashed position/size never depends on the camera — only WHICH cells get iterated each
 * frame does — so the field never shimmers between frames at a fixed zoom/viewpoint, and is
 * reproducible (same seed -> same sky) and resize-proof. This is cosmetic and outside the
 * physics-determinism contract (docs/GAME.md §4 "Determinism": rendering may diverge).
 *
 * Perf: stars are grouped into a handful of colour "shades" per layer at DRAW time (not build
 * time, since there's no longer a fixed star list to precompute), so `drawStarfield` does one
 * `beginPath`/`fill` per shade instead of one per star — measured to matter in the original
 * fixed-list version (T-04 AURORA: ~190 individual arc+fill calls contributing measurably to
 * per-frame cost, see notes/T-04-AURORA/log.md) and equally true here.
 */

import type { Viewport } from "./transform";

export interface StarLayer {
  /** Fraction of the viewpoint's pan this layer follows. 1 = rigidly locked to the scene (the
   *  furthest layer); smaller values lag behind, for a mild depth cue. */
  pan: number;
  /** Per-layer hash seed (derived from the field's overall seed — see `buildStarfield`). */
  seed: number;
  /** Reference world-space grid cell size at LOD octave 0. */
  baseCellWorld: number;
  /** Probability [0, 1] that a given grid cell contains a star. */
  density: number;
  /** Star radius, as a fraction of the current cell's world size (so it scales with the LOD
   *  octave the same way the grid does — see module doc comment). */
  sizeMin: number;
  sizeMax: number;
  alpha: number;
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

const SHADES_PER_LAYER: number = 4;

/** Ratio between consecutive LOD octaves' cell size. 4 keeps octave transitions (zoom must cross a
 *  full doubling-squared to trigger one) infrequent without needing hysteresis. */
const LOD_RATIO = 4;

/** Target on-screen cell size (CSS px) the LOD octave search aims for — this single constant is
 *  what makes star count and star screen-size roughly zoom-invariant (see module doc comment). */
const TARGET_CELL_PX = 96;

/** Extra ring of cells around the viewport, so a star whose CENTER falls just outside the visible
 *  rect (but whose disc still overlaps it) isn't culled. */
const CELL_MARGIN = 1;

/** Defensive clamp on the LOD octave search — at any real zoom value this is never approached
 *  (octave 40 alone is a 4^40 world-unit cell), it only guards against a degenerate/NaN zoom. */
const MAX_OCTAVE_MAGNITUDE = 48;

/** Per-layer blueprints, furthest (index 0, rigidly locked) to nearest. Densities/sizes chosen to
 *  land in roughly the same visual range as the field's original fixed-list version. */
const LAYER_BLUEPRINTS: ReadonlyArray<Omit<StarLayer, "seed">> = [
  {
    pan: 1.0,
    baseCellWorld: 260,
    density: 0.5,
    sizeMin: 0.008,
    sizeMax: 0.019,
    alpha: 0.25,
  },
  {
    pan: 0.55,
    baseCellWorld: 220,
    density: 0.65,
    sizeMin: 0.019,
    sizeMax: 0.03,
    alpha: 0.39,
  },
  {
    pan: 0.3,
    baseCellWorld: 190,
    density: 0.8,
    sizeMin: 0.03,
    sizeMax: 0.041,
    alpha: 0.53,
  },
];

/** 32-bit integer mix — small, fast, deterministic, and (unlike a sequential PRNG) directly
 *  addressable by arbitrary (possibly negative) cell coordinates, which is what makes on-the-fly
 *  per-cell generation possible without ever storing anything. */
function hash32(a: number, b: number, c: number, d: number): number {
  let h = (Math.imul(a, 0x1f1f1f1f) ^ Math.imul(b, 0x2545f491)) >>> 0;
  h = (h ^ Math.imul(c, 0x9e3779b1) ^ Math.imul(d, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function buildStarfield(seed: number = STARFIELD_SEED): StarLayer[] {
  return LAYER_BLUEPRINTS.map((blueprint, layerIndex) => ({
    ...blueprint,
    seed:
      (Math.imul(seed ^ 0x9e3779b9, 0x85ebca77) ^
        Math.imul(layerIndex + 1, 0xc2b2ae3d)) >>>
      0,
  }));
}

function shadeColor(shade: number, alpha: number): string {
  const t = SHADES_PER_LAYER === 1 ? 0 : shade / (SHADES_PER_LAYER - 1);
  const r = (0.72 + t * 0.28) * 255;
  const g = (0.82 + t * 0.18) * 255;
  return `rgba(${r}, ${g}, 255, ${alpha})`;
}

/** Picks the LOD octave whose cell size, at `zoom`, lands closest to `TARGET_CELL_PX` on screen. */
function pickOctave(baseCellWorld: number, zoom: number): number {
  const raw =
    Math.log(TARGET_CELL_PX / (baseCellWorld * zoom)) / Math.log(LOD_RATIO);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(
    -MAX_OCTAVE_MAGNITUDE,
    Math.min(MAX_OCTAVE_MAGNITUDE, Math.round(raw)),
  );
}

/**
 * Projects one background world point to screen space, for a given `pan` fraction of `viewpoint`.
 * Deliberately the REVERSE of a plain world object's `halfW + (world - viewpoint) * zoom`: the
 * `pan` term is ADDED here, not subtracted, so a background point moves WITH the direction the
 * viewpoint itself pans (screen `+x` when the viewpoint pans `+x`) rather than opposite it. Split
 * out from `drawLayer` so this sign convention has one place to read and to test directly.
 */
export function projectBackgroundPoint(
  viewpoint: { x: number; y: number },
  worldX: number,
  worldY: number,
  pan: number,
  zoom: number,
  viewport: Viewport,
): { x: number; y: number } {
  const panX = viewpoint.x * pan;
  const panY = viewpoint.y * pan;
  return {
    x: viewport.width * 0.5 + (panX - worldX) * zoom,
    y: viewport.height * 0.5 + (panY - worldY) * zoom,
  };
}

interface ShadeBucketPoint {
  x: number;
  y: number;
  r: number;
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: StarLayer,
  viewport: Viewport,
  viewpoint: BackgroundViewpoint,
): void {
  const zoom = viewpoint.zoom > 0 ? viewpoint.zoom : 1;
  const octave = pickOctave(layer.baseCellWorld, zoom);
  const cellSize = layer.baseCellWorld * Math.pow(LOD_RATIO, octave);
  const octaveSeed = (layer.seed ^ Math.imul(octave + 1000, 0x1000193)) >>> 0;

  const panX = viewpoint.x * layer.pan;
  const panY = viewpoint.y * layer.pan;

  const halfWorldW = viewport.width / (2 * zoom);
  const halfWorldH = viewport.height / (2 * zoom);

  const minCx = Math.floor((panX - halfWorldW) / cellSize) - CELL_MARGIN;
  const maxCx = Math.ceil((panX + halfWorldW) / cellSize) + CELL_MARGIN;
  const minCy = Math.floor((panY - halfWorldH) / cellSize) - CELL_MARGIN;
  const maxCy = Math.ceil((panY + halfWorldH) / cellSize) + CELL_MARGIN;

  const shadeBuckets: ShadeBucketPoint[][] = Array.from(
    { length: SHADES_PER_LAYER },
    () => [],
  );

  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const occupancy = hash32(octaveSeed, cx, cy, 0);
      if (occupancy > layer.density) continue;
      const nx = hash32(octaveSeed, cx, cy, 1);
      const ny = hash32(octaveSeed, cx, cy, 2);
      const sizeRoll = hash32(octaveSeed, cx, cy, 3);
      const shadeRoll = hash32(octaveSeed, cx, cy, 4);

      const worldX = (cx + nx) * cellSize;
      const worldY = (cy + ny) * cellSize;
      const { x, y } = projectBackgroundPoint(
        viewpoint,
        worldX,
        worldY,
        layer.pan,
        zoom,
        viewport,
      );

      const sizeFactor =
        layer.sizeMin + sizeRoll * (layer.sizeMax - layer.sizeMin);
      const r = sizeFactor * cellSize * zoom;
      const shade = Math.floor(shadeRoll * SHADES_PER_LAYER) % SHADES_PER_LAYER;
      shadeBuckets[shade]!.push({ x, y, r });
    }
  }

  for (let shade = 0; shade < SHADES_PER_LAYER; shade++) {
    const points = shadeBuckets[shade]!;
    if (points.length === 0) continue;
    ctx.beginPath();
    for (const p of points) {
      ctx.moveTo(p.x + p.r, p.y);
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    }
    ctx.fillStyle = shadeColor(shade, layer.alpha);
    ctx.fill();
  }
}

/**
 * Draws the background gradient wash + starfield.
 *
 * `viewpoint` is the scene's current `{x, y, zoom}` (the fit rect's center and zoom — same values
 * as `RenderFrame.camera`).
 */
export function drawStarfield(
  ctx: CanvasRenderingContext2D,
  layers: readonly StarLayer[],
  viewport: Viewport,
  viewpoint: BackgroundViewpoint,
): void {
  const w = viewport.width;
  const h = viewport.height;

  ctx.fillStyle = "rgba(5,8,18,1)";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(13,28,51,0.22)";
  ctx.fillRect(0, 0, w, h);

  for (const layer of layers) {
    drawLayer(ctx, layer, viewport, viewpoint);
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

/** Exposed for tests that need to reason about cell sizing without duplicating the constant. */
export const STARFIELD_TARGET_CELL_PX = TARGET_CELL_PX;
