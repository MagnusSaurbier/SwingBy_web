/**
 * Deterministic, infinite parallax starfield, anchored to WORLD-space coordinates so that
 * scaling/panning the scene (the fitted camera rect resizing as tracked bodies move) reads as the
 * camera moving through a fixed sky, not as the sky itself drifting.
 *
 * Stars are generated ON THE FLY from a spatial hash grid — never precomputed into a finite list —
 * so the field has no edge: it covers however large or small a rectangle the camera ends up
 * fitting, with no "you've flown past the edge of the sky" gap.
 *
 * Two independent axes, on purpose (a star's depth says nothing about its size — there can be
 * small near stars and huge far ones):
 *
 *   - DEPTH: each star's own `pan` (the fraction of the viewpoint it tracks) is hashed
 *     independently per star, UNIFORMLY between `MIN_STAR_PAN` and `MAX_STAR_PAN` — see those
 *     constants to tune the depth range directly. `pan` multiplies the viewpoint in
 *     `projectBackgroundPoint`; the further from 0, the more that star's screen position responds
 *     to the scene panning. Because pan is continuous per star rather than a small fixed set of
 *     tiers, the per-octave cell-search window (see `collectStars`) has to be widened to cover the
 *     WHOLE `[MIN_STAR_PAN, MAX_STAR_PAN]` range rather than one fixed value — the wider that
 *     range, and the further the viewpoint sits from the world origin, the more (harmless, just
 *     extra-hashed-and-culled) cells get checked. Fine for the small ranges this is tuned for;
 *     don't set MIN/MAX wildly far apart on a level with a huge world extent.
 *   - SIZE (`MIN_STAR_SIZE`/`MAX_STAR_SIZE`/`SIZE_LAMBDA`): each star's radius, as a fraction of
 *     its cell's world size, is drawn from an exponential distribution independently of its pan —
 *     so depth and size never correlate.
 *
 * SIZE is generated across a hierarchy of grid resolutions ("octaves": cell size =
 * `SHARED_BASE_CELL_WORLD * LOD_RATIO^octave`) so that at any zoom, only a bounded, roughly
 * constant number of octaves/cells need checking (`fineOctaveLimit` skips octaves whose stars
 * would all be sub-pixel; `COARSE_OCTAVE_SPAN` bounds how much coarser — and rarer — we still
 * check, so a big star sitting within a zoomed-in view is still found and drawn). Crucially there
 * is no single SELECTED octave per frame (that would swap an entire population of stars in or out
 * at once, popping visibly) — every octave in range is checked every frame, and each candidate
 * star is culled individually the moment its own on-screen radius (re-evaluated fresh every
 * frame, since it depends on zoom) falls outside `[MIN_STAR_SIZE, MAX_STAR_SIZE]`.
 * Since a star's world position, size, and pan are all fixed functions of its (octave, cell) key,
 * the SAME star persists across a continuous zoom change: it never disappears and reappears as
 * something else, it just shrinks/grows continuously and crosses the visibility threshold on its
 * own, independent of the other stars sharing its octave.
 *
 * A star's hashed position/size/pan never depends on the camera — only WHICH cells get iterated
 * each frame does — so the field never shimmers between frames at a fixed zoom/viewpoint, and is
 * reproducible (same seed -> same sky) and resize-proof. This is cosmetic and outside the
 * physics-determinism contract (docs/GAME.md §4 "Determinism": rendering may diverge).
 *
 * Perf: stars are grouped into a handful of colour "shades" at DRAW time (not build time, since
 * there's no fixed star list to precompute), so `drawStarfield` does one `beginPath`/`fill` per
 * shade instead of one per star — measured to matter in the original fixed-list version (T-04
 * AURORA: ~190 individual arc+fill calls contributing measurably to per-frame cost, see
 * notes/T-04-AURORA/log.md) and equally true here.
 */

import type { Viewport } from "./transform";

export interface StarField {
  /** Hash seed for the whole field — see `buildStarfield`. */
  seed: number;
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

const SHADE_COUNT: number = 4;

/** Every star is drawn at this fixed alpha — depth/size no longer imply an opacity tier. */
const STAR_ALPHA = 1.0;

/** Ratio between consecutive LOD octaves' cell size. 4 keeps octave transitions infrequent. */
const LOD_RATIO = 4;

/** How many octaves coarser than the finest-still-plausibly-visible one are also checked, so a
 *  big/rare star is found and drawn even deep inside a zoomed-in view — each coarser octave has
 *  ~1/LOD_RATIO^2 as many cells, so this is cheap (a converging geometric series, not a
 *  multiplier). */
const COARSE_OCTAVE_SPAN = 6;

/** Extra ring of cells around the viewport, so a star whose CENTER falls just outside the visible
 *  rect (but whose disc still overlaps it) isn't culled. */
const CELL_MARGIN = 1;

/** Defensive clamp on the octave search — at any real zoom value this is never approached (octave
 *  40 alone is a 4^40 world-unit cell), it only guards against a degenerate/NaN zoom. */
const MAX_OCTAVE_MAGNITUDE = 48;

/** Reference world-space grid cell size at LOD octave 0. */
const SHARED_BASE_CELL_WORLD = 220;
/** Probability [0, 1] a given grid cell contains a star, BEFORE the size rejection below also
 *  thins the population (see `SIZE_LAMBDA`). */
const SHARED_DENSITY = 0.6;

/**
 * A star's radius, as a fraction of its cell's world size ("size factor"), is drawn from an
 * EXPONENTIAL distribution with rate `SIZE_LAMBDA` on `[0, Infinity)` via inverse-CDF sampling
 * (`-ln(1 - U) / lambda`) — so most stars cluster near the small end (an exponential's mode is
 * 0), with a thinning tail of rarer, larger ones, exactly like a real starfield's brightness
 * distribution. Larger `SIZE_LAMBDA` concentrates sizes closer to 0; smaller spreads them out.
 *
 * The size factor itself is NOT clamped — `MIN_STAR_SIZE`/`MAX_STAR_SIZE` instead bound the
 * DISPLAY size (`size factor * cell size * zoom`, in CSS px), re-checked fresh every frame. A
 * star's cell is treated as empty (not resampled) if its display size falls outside that range at
 * the CURRENT zoom — so the same star can be accepted while zoomed in (big enough on screen) and
 * rejected once zoomed out past `MIN_STAR_SIZE` (too small), or vice versa past `MAX_STAR_SIZE`.
 */
export const SIZE_LAMBDA = 50;
export const MIN_STAR_SIZE = 0.3;
export const MAX_STAR_SIZE = 20;

/** Cumulative probability used ONLY to decide whether an octave is worth iterating at all (see
 *  `fineOctaveLimit`) — not part of the real per-star accept/reject test above, which always uses
 *  the true, unbounded exponential sample. An octave is skipped once even a star at this tail size
 *  factor would fall below `MIN_STAR_SIZE` on screen. Deliberately not made vanishingly small: a
 *  fine octave's job is to supply abundant SMALL stars — the rare large excursions this trades
 *  away are already covered by the coarser octaves `COARSE_OCTAVE_SPAN` keeps checking, and every
 *  order of magnitude smaller this gets pushes the finest checked octave (and its cell count) up
 *  by another factor of `LOD_RATIO`. */
const OCTAVE_SKIP_TAIL_PROBABILITY = 0.05;

/**
 * A star's own `pan` (see module doc comment) is hashed uniformly between these two — tune the
 * depth range directly here. `0` means a star doesn't move at all as the scene pans (rigidly
 * fixed to the screen); `1` means it moves exactly like a plain world object; negative values
 * make it drift OPPOSITE the direction the scene pans, exaggerating the depth cue.
 */
export const MIN_STAR_PAN = -0.5;
export const MAX_STAR_PAN = 0.0;

/** Hard ceiling on how many cells one octave's search window can span PER AXIS, regardless of how
 *  wide `[MIN_STAR_PAN, MAX_STAR_PAN]` is or how far the viewpoint sits from the origin. Normal
 *  play never approaches this (see the module doc comment's pan-window trade-off) — it exists so a
 *  pathological viewpoint (an extreme camera position, an editor preview, a bug elsewhere) always
 *  costs a bounded amount of work instead of silently scaling with viewpoint magnitude. Clamping
 *  shrinks the window around its own center, so it degrades to "some cells near the union range
 *  missing" rather than growing unbounded. */
const MAX_CELLS_PER_AXIS = 512;

function clampSpan(min: number, max: number): [number, number] {
  if (max - min <= MAX_CELLS_PER_AXIS) return [min, max];
  const center = (min + max) / 2;
  return [
    Math.floor(center - MAX_CELLS_PER_AXIS / 2),
    Math.ceil(center + MAX_CELLS_PER_AXIS / 2),
  ];
}

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

export function buildStarfield(seed: number = STARFIELD_SEED): StarField {
  return { seed };
}

function shadeColor(shade: number): string {
  const t = SHADE_COUNT === 1 ? 0 : shade / (SHADE_COUNT - 1);
  const r = (0.72 + t * 0.28) * 255;
  const g = (0.82 + t * 0.18) * 255;
  return `rgba(${r}, ${g}, 255, ${STAR_ALPHA})`;
}

/** Size factor exceeded only with probability `OCTAVE_SKIP_TAIL_PROBABILITY` under
 *  Exponential(SIZE_LAMBDA) — from the CDF, `P(X > x) = e^-(lambda*x) = p` at
 *  `x = -ln(p) / lambda`. Used only to bound the octave search, never the real per-star test. */
const PRACTICALLY_MAX_SIZE_FACTOR =
  -Math.log(OCTAVE_SKIP_TAIL_PROBABILITY) / SIZE_LAMBDA;

/** Finest (smallest, most negative) octave worth checking at `zoom`: below this, even a star at
 *  the (utterly negligible-odds) `PRACTICALLY_MAX_SIZE_FACTOR` tail would display at less than
 *  `MIN_STAR_SIZE` px, so every star in it would almost certainly be rejected anyway — skip the
 *  whole octave (and its cells) rather than generating and then discarding them one at a time.
 *  Recomputed fresh from `zoom` every call — see `MIN_STAR_SIZE`'s doc comment on why the
 *  accept/reject test (and this bound) is dynamic rather than fixed at generation time. */
function fineOctaveLimit(zoom: number): number {
  const raw =
    Math.log(
      MIN_STAR_SIZE /
        (PRACTICALLY_MAX_SIZE_FACTOR * SHARED_BASE_CELL_WORLD * zoom),
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
 * `pan` term is ADDED here, not subtracted, so (for `pan > 0`) a background point moves WITH the
 * direction the viewpoint itself pans rather than opposite it. Split out from `collectStars` so
 * this sign convention has one place to read and to test directly.
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
  pan: number;
  shade: number;
}

/** Collects every star currently within `viewport` at `viewpoint`, across every LOD octave in
 *  range (see module doc comment) — the single source of truth both `drawStarfield` and tests use
 *  for "what stars are visible right now", so there's no separate code path to drift. */
export function collectStars(
  field: StarField,
  viewport: Viewport,
  viewpoint: BackgroundViewpoint,
): VisibleStar[] {
  const zoom = viewpoint.zoom > 0 ? viewpoint.zoom : 1;
  const halfWorldW = viewport.width / (2 * zoom);
  const halfWorldH = viewport.height / (2 * zoom);

  // A star's own pan can be anywhere in [MIN_STAR_PAN, MAX_STAR_PAN] (hashed per-star below), so
  // the search window has to cover the UNION of visible ranges across that whole interval — the
  // extremes of a linear function over an interval are at its endpoints.
  const panAtMin = {
    x: viewpoint.x * MIN_STAR_PAN,
    y: viewpoint.y * MIN_STAR_PAN,
  };
  const panAtMax = {
    x: viewpoint.x * MAX_STAR_PAN,
    y: viewpoint.y * MAX_STAR_PAN,
  };
  const panLoX = Math.min(panAtMin.x, panAtMax.x);
  const panHiX = Math.max(panAtMin.x, panAtMax.x);
  const panLoY = Math.min(panAtMin.y, panAtMax.y);
  const panHiY = Math.max(panAtMin.y, panAtMax.y);

  const stars: VisibleStar[] = [];

  const fineLimit = fineOctaveLimit(zoom);
  const coarseLimit = Math.min(
    MAX_OCTAVE_MAGNITUDE,
    fineLimit + COARSE_OCTAVE_SPAN,
  );

  for (let octave = fineLimit; octave <= coarseLimit; octave++) {
    const cellSize = SHARED_BASE_CELL_WORLD * Math.pow(LOD_RATIO, octave);
    const octaveSeed = (field.seed ^ Math.imul(octave + 1000, 0x1000193)) >>> 0;

    const [minCx, maxCx] = clampSpan(
      Math.floor((panLoX - halfWorldW) / cellSize) - CELL_MARGIN,
      Math.ceil((panHiX + halfWorldW) / cellSize) + CELL_MARGIN,
    );
    const [minCy, maxCy] = clampSpan(
      Math.floor((panLoY - halfWorldH) / cellSize) - CELL_MARGIN,
      Math.ceil((panHiY + halfWorldH) / cellSize) + CELL_MARGIN,
    );

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const occupancy = hash32(octaveSeed, cx, cy, 0);
        if (occupancy > SHARED_DENSITY) continue;

        // Inverse-CDF sampling of Exponential(SIZE_LAMBDA) on [0, Infinity) — the size FACTOR
        // itself is never clamped. Its DISPLAY size (this frame's zoom applied) is what gets
        // rejected outside [MIN_STAR_SIZE, MAX_STAR_SIZE] — see `MIN_STAR_SIZE`'s doc comment.
        const sizeRoll = hash32(octaveSeed, cx, cy, 3);
        const sizeFactor = -Math.log(1 - sizeRoll) / SIZE_LAMBDA;
        const r = sizeFactor * cellSize * zoom;
        if (r < MIN_STAR_SIZE || r > MAX_STAR_SIZE) continue;

        const nx = hash32(octaveSeed, cx, cy, 1);
        const ny = hash32(octaveSeed, cx, cy, 2);
        const shadeRoll = hash32(octaveSeed, cx, cy, 4);
        const panRoll = hash32(octaveSeed, cx, cy, 5);
        const pan = MIN_STAR_PAN + panRoll * (MAX_STAR_PAN - MIN_STAR_PAN);

        const worldX = (cx + nx) * cellSize;
        const worldY = (cy + ny) * cellSize;
        const { x, y } = projectBackgroundPoint(
          viewpoint,
          worldX,
          worldY,
          pan,
          zoom,
          viewport,
        );
        // The search window is a conservative UNION over all possible pans; this star's own
        // (already-hashed) pan may place it outside the actual viewport — cull it here rather
        // than drawing (harmlessly, but wastefully) off-canvas.
        if (
          x + r < 0 ||
          x - r > viewport.width ||
          y + r < 0 ||
          y - r > viewport.height
        ) {
          continue;
        }

        const shade = Math.floor(shadeRoll * SHADE_COUNT) % SHADE_COUNT;
        stars.push({ worldX, worldY, x, y, r, pan, shade });
      }
    }
  }

  return stars;
}

/**
 * Draws the background gradient wash + starfield.
 *
 * `viewpoint` is the scene's current `{x, y, zoom}` (the fit rect's center and zoom — same values
 * as `RenderFrame.camera`).
 */
export function drawStarfield(
  ctx: CanvasRenderingContext2D,
  field: StarField,
  viewport: Viewport,
  viewpoint: BackgroundViewpoint,
): void {
  const w = viewport.width;
  const h = viewport.height;

  ctx.fillStyle = "rgba(5,8,18,1)";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(13,28,51,0.22)";
  ctx.fillRect(0, 0, w, h);

  const shadeBuckets: VisibleStar[][] = Array.from(
    { length: SHADE_COUNT },
    () => [],
  );
  for (const star of collectStars(field, viewport, viewpoint)) {
    shadeBuckets[star.shade]!.push(star);
  }
  for (let shade = 0; shade < SHADE_COUNT; shade++) {
    const points = shadeBuckets[shade]!;
    if (points.length === 0) continue;
    ctx.beginPath();
    for (const p of points) {
      ctx.moveTo(p.x + p.r, p.y);
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    }
    ctx.fillStyle = shadeColor(shade);
    ctx.fill();
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
