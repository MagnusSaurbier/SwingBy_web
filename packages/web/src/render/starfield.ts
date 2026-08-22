/**
 * Deterministic, infinite parallax starfield, anchored to WORLD-space coordinates so that
 * scaling/panning the scene (the fitted camera rect resizing as tracked bodies move) reads as the
 * camera moving through a fixed sky, not as the sky itself drifting.
 *
 * Stars are generated ON THE FLY from a spatial hash grid — never precomputed into a finite list —
 * so the field has no edge: it covers however large or small a rectangle the camera ends up
 * fitting, with no "you've flown past the edge of the sky" gap.
 *
 * Two independent axes, on purpose (a star's parallax tier does NOT determine its size range —
 * there can be small near stars and huge far ones):
 *
 *   - DEPTH (parallax tier, `StarLayer.pan`): a small fixed set of `pan` values (see `PAN_TIERS`),
 *     each an independent copy of the SAME hash grid (same cell-size/density/size distribution,
 *     just a different seed) at a different `pan` fraction of the viewpoint. `pan === 1` is
 *     rigidly locked to the viewpoint (only moves because the SCENE moved); smaller values lag
 *     behind, for a mild depth cue. A small fixed set (rather than a continuously-hashed per-star
 *     pan) is deliberate: the visible-cell window for a tier is computed once from its single
 *     `pan` value, which would blow up into scanning a huge extra range of cells if `pan` varied
 *     continuously per star while the viewpoint sits far from the origin.
 *   - SIZE (`sizeMin`/`sizeMax`, shared across every tier): each star's radius, as a fraction of
 *     its cell's world size, is hashed independently of which tier it's in — so a tier's identity
 *     says nothing about how big its stars tend to be.
 *
 * SIZE is generated across a hierarchy of grid resolutions ("octaves": cell size =
 * `SHARED_BASE_CELL_WORLD * LOD_RATIO^octave`) so that at any zoom, only a bounded, roughly
 * constant number of octaves/cells need checking (`fineOctaveLimit` skips octaves whose stars
 * would all be sub-pixel; `COARSE_OCTAVE_SPAN` bounds how much coarser — and rarer — we still
 * check, so a big star sitting within a zoomed-in view is still found and drawn). Crucially there
 * is no single SELECTED octave per frame (that would swap an entire population of stars in or out
 * at once, popping visibly) — every octave in range is checked every frame, and each candidate
 * star is culled individually the moment its own on-screen radius drops below `MIN_VISIBLE_PX`.
 * Since a star's world position, size, and tier are all fixed functions of its (tier, octave, cell)
 * key, the SAME star persists across a continuous zoom change: it never disappears and reappears
 * as something else, it just shrinks/grows continuously and crosses the visibility threshold on
 * its own, independent of the ~hundred other stars sharing its octave.
 *
 * A star's hashed position/size/tier never depends on the camera — only WHICH cells get iterated
 * each frame does — so the field never shimmers between frames at a fixed zoom/viewpoint, and is
 * reproducible (same seed -> same sky) and resize-proof. This is cosmetic and outside the
 * physics-determinism contract (docs/GAME.md §4 "Determinism": rendering may diverge).
 *
 * Perf: stars are grouped into a handful of colour "shades" per tier at DRAW time (not build time,
 * since there's no fixed star list to precompute), so `drawStarfield` does one `beginPath`/`fill`
 * per shade instead of one per star — measured to matter in the original fixed-list version (T-04
 * AURORA: ~190 individual arc+fill calls contributing measurably to per-frame cost, see
 * notes/T-04-AURORA/log.md) and equally true here.
 */

import type { Viewport } from "./transform";

export interface StarLayer {
  /** Fraction of the viewpoint's pan this tier follows. 1 = rigidly locked to the scene; smaller
   *  values lag behind, for a mild depth cue. Independent of star size — see module doc comment. */
  pan: number;
  /** Per-tier hash seed (derived from the field's overall seed — see `buildStarfield`). */
  seed: number;
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

/** Ratio between consecutive LOD octaves' cell size. 4 keeps octave transitions infrequent. */
const LOD_RATIO = 4;

/** Below this on-screen radius (CSS px) a star isn't worth drawing. Both the per-star cutoff that
 *  lets stars fade in/out individually, and (via `fineOctaveLimit`) the bound on how many small
 *  cells get iterated when zoomed out. */
const MIN_VISIBLE_PX = 0.35;

/** How many octaves coarser than the finest-still-visible one are also checked, so a big/rare star
 *  is found and drawn even deep inside a zoomed-in view — each coarser octave has ~1/LOD_RATIO^2
 *  as many cells, so this is cheap (a converging geometric series, not a multiplier). */
const COARSE_OCTAVE_SPAN = 6;

/** Extra ring of cells around the viewport, so a star whose CENTER falls just outside the visible
 *  rect (but whose disc still overlaps it) isn't culled. */
const CELL_MARGIN = 1;

/** Defensive clamp on the octave search — at any real zoom value this is never approached (octave
 *  40 alone is a 4^40 world-unit cell), it only guards against a degenerate/NaN zoom. */
const MAX_OCTAVE_MAGNITUDE = 48;

/** Reference world-space grid cell size at LOD octave 0, shared by every pan tier. */
const SHARED_BASE_CELL_WORLD = 220;
/** Probability [0, 1] a given grid cell contains a star, shared by every pan tier. */
const SHARED_DENSITY = 0.6;
/** Star radius, as a fraction of its cell's world size — shared by every pan tier so size is
 *  independent of parallax depth (see module doc comment). */
const SHARED_SIZE_MIN = 0.008;
const SHARED_SIZE_MAX = 0.05;

/** Parallax tiers, furthest (pan=1, rigidly locked) to nearest. Deliberately NOT paired with a
 *  size range — every tier draws from the identical shared size distribution. */
const PAN_TIERS: ReadonlyArray<{ pan: number; alpha: number }> = [
  { pan: 1.0, alpha: 0.28 },
  { pan: 0.6, alpha: 0.4 },
  { pan: 0.25, alpha: 0.52 },
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
  return PAN_TIERS.map((tier, tierIndex) => ({
    pan: tier.pan,
    alpha: tier.alpha,
    seed:
      (Math.imul(seed ^ 0x9e3779b9, 0x85ebca77) ^
        Math.imul(tierIndex + 1, 0xc2b2ae3d)) >>>
      0,
  }));
}

function shadeColor(shade: number, alpha: number): string {
  const t = SHADES_PER_LAYER === 1 ? 0 : shade / (SHADES_PER_LAYER - 1);
  const r = (0.72 + t * 0.28) * 255;
  const g = (0.82 + t * 0.18) * 255;
  return `rgba(${r}, ${g}, 255, ${alpha})`;
}

/** Finest (smallest, most negative) octave worth checking at `zoom`: below this, even the
 *  largest star the shared size distribution can produce (`SHARED_SIZE_MAX`) would round to less
 *  than `MIN_VISIBLE_PX` on screen, so every star in it would be culled anyway — skip the whole
 *  octave (and its cells) rather than generating and then discarding them one at a time. */
function fineOctaveLimit(zoom: number): number {
  const raw =
    Math.log(
      MIN_VISIBLE_PX / (SHARED_SIZE_MAX * SHARED_BASE_CELL_WORLD * zoom),
    ) / Math.log(LOD_RATIO);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(
    -MAX_OCTAVE_MAGNITUDE,
    Math.min(MAX_OCTAVE_MAGNITUDE, Math.ceil(raw)),
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

/**
 * One star, as actually selected for this frame. `worldX/Y` is its fixed, camera-independent
 * position (same key -> same world position forever, see module doc comment); `x/y/r` is its
 * projected screen position and radius (CSS px) for this specific viewpoint/zoom. Exported mainly
 * so tests can verify a star's identity/growth across a zoom change directly, without scraping
 * canvas call logs.
 */
export interface VisibleStar {
  worldX: number;
  worldY: number;
  x: number;
  y: number;
  r: number;
  shade: number;
}

/** Collects every star of one pan tier currently within `viewport` at `viewpoint`, across every
 *  LOD octave in range (see module doc comment) — the single source of truth both `drawLayer` and
 *  tests use for "what stars are visible right now", so there's no separate code path to drift. */
function collectLayerStars(
  layer: StarLayer,
  viewport: Viewport,
  viewpoint: BackgroundViewpoint,
): VisibleStar[] {
  const zoom = viewpoint.zoom > 0 ? viewpoint.zoom : 1;
  const panX = viewpoint.x * layer.pan;
  const panY = viewpoint.y * layer.pan;

  const halfWorldW = viewport.width / (2 * zoom);
  const halfWorldH = viewport.height / (2 * zoom);

  const stars: VisibleStar[] = [];

  const fineLimit = fineOctaveLimit(zoom);
  const coarseLimit = Math.min(
    MAX_OCTAVE_MAGNITUDE,
    fineLimit + COARSE_OCTAVE_SPAN,
  );

  for (let octave = fineLimit; octave <= coarseLimit; octave++) {
    const cellSize = SHARED_BASE_CELL_WORLD * Math.pow(LOD_RATIO, octave);
    const octaveSeed = (layer.seed ^ Math.imul(octave + 1000, 0x1000193)) >>> 0;

    const minCx = Math.floor((panX - halfWorldW) / cellSize) - CELL_MARGIN;
    const maxCx = Math.ceil((panX + halfWorldW) / cellSize) + CELL_MARGIN;
    const minCy = Math.floor((panY - halfWorldH) / cellSize) - CELL_MARGIN;
    const maxCy = Math.ceil((panY + halfWorldH) / cellSize) + CELL_MARGIN;

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const occupancy = hash32(octaveSeed, cx, cy, 0);
        if (occupancy > SHARED_DENSITY) continue;

        const sizeRoll = hash32(octaveSeed, cx, cy, 3);
        const sizeFactor =
          SHARED_SIZE_MIN + sizeRoll * (SHARED_SIZE_MAX - SHARED_SIZE_MIN);
        const r = sizeFactor * cellSize * zoom;
        if (r < MIN_VISIBLE_PX) continue;

        const nx = hash32(octaveSeed, cx, cy, 1);
        const ny = hash32(octaveSeed, cx, cy, 2);
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

        const shade =
          Math.floor(shadeRoll * SHADES_PER_LAYER) % SHADES_PER_LAYER;
        stars.push({ worldX, worldY, x, y, r, shade });
      }
    }
  }

  return stars;
}

/** All visible stars across every pan tier, for a given viewport/viewpoint. See `VisibleStar`. */
export function collectVisibleStars(
  layers: readonly StarLayer[],
  viewport: Viewport,
  viewpoint: BackgroundViewpoint,
): VisibleStar[] {
  const stars: VisibleStar[] = [];
  for (const layer of layers) {
    stars.push(...collectLayerStars(layer, viewport, viewpoint));
  }
  return stars;
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: StarLayer,
  viewport: Viewport,
  viewpoint: BackgroundViewpoint,
): void {
  const shadeBuckets: VisibleStar[][] = Array.from(
    { length: SHADES_PER_LAYER },
    () => [],
  );
  for (const star of collectLayerStars(layer, viewport, viewpoint)) {
    shadeBuckets[star.shade]!.push(star);
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
