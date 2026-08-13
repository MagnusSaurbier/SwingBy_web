/**
 * Rocket sprite loading. Four appearances, each with a distinct "boosting" variant — see
 * reference/godot/scripts/GameWorld.gd:64-66 (`_ready` loads `rocket%d.png` / `rocket%d_boost.png`
 * for index 1..4) and :824-832 (`_draw_objects`, `player` branch: boost variant picked by
 * `is_boosting`).
 *
 * PNGs copied byte-for-byte from reference/godot/images/ into ./assets/ (reference/ is read-only
 * and never imported from — see PROJECT.md "Source material" and this task's hard rules).
 *
 * `new URL('./assets/...png', import.meta.url)` is native ESM, resolved by the browser (or by
 * Vite's static-asset analysis, which requires a literal string per call — hence eight explicit
 * calls below rather than one built from a template) with no bundler-specific import syntax. It
 * also does not touch `document`/`Image`, so importing this module never throws under plain-Node
 * vitest (see notes/T-04-AURORA/log.md — no jsdom in this project, `Image` is undefined in tests).
 */

const ROCKET_URLS: readonly string[] = [
  new URL("./assets/rocket1.png", import.meta.url).href,
  new URL("./assets/rocket2.png", import.meta.url).href,
  new URL("./assets/rocket3.png", import.meta.url).href,
  new URL("./assets/rocket4.png", import.meta.url).href,
];

const ROCKET_BOOST_URLS: readonly string[] = [
  new URL("./assets/rocket1_boost.png", import.meta.url).href,
  new URL("./assets/rocket2_boost.png", import.meta.url).href,
  new URL("./assets/rocket3_boost.png", import.meta.url).href,
  new URL("./assets/rocket4_boost.png", import.meta.url).href,
];

function clampBoostType(boostType: number): number {
  if (!Number.isFinite(boostType)) return 0;
  if (boostType < 0) return 0;
  if (boostType > 3) return 3;
  return Math.trunc(boostType);
}

/**
 * Loads and caches the eight rocket images. Only ever touches the `Image` constructor lazily,
 * so constructing a SpriteSet is safe even where `Image` does not exist (plain-Node test runs) —
 * `get()` simply returns null forever in that environment, and callers (bodies.ts) fall back to
 * a procedural silhouette instead of a texture.
 */
export interface SpriteSet {
  /** Returns the loaded image, or null if unavailable/still loading — caller must have a fallback. */
  get(boostType: number, boosting: boolean): HTMLImageElement | null;
}

export function createSpriteSet(): SpriteSet {
  const normal: (HTMLImageElement | undefined)[] = [undefined, undefined, undefined, undefined];
  const boosting: (HTMLImageElement | undefined)[] = [undefined, undefined, undefined, undefined];
  const canLoadImages = typeof Image !== "undefined";

  function ensureLoaded(index: number, isBoosting: boolean): HTMLImageElement | null {
    if (!canLoadImages) return null;
    const bucket = isBoosting ? boosting : normal;
    const existing = bucket[index];
    if (existing) {
      return existing.complete && existing.naturalWidth > 0 ? existing : null;
    }
    const img = new Image();
    img.decoding = "async";
    img.src = (isBoosting ? ROCKET_BOOST_URLS : ROCKET_URLS)[index]!;
    bucket[index] = img;
    // First call after src assignment: almost never complete yet (network/decoder is async).
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  return {
    get(boostType: number, isBoosting: boolean): HTMLImageElement | null {
      return ensureLoaded(clampBoostType(boostType), isBoosting);
    },
  };
}
