/**
 * T-09 GAUGE — CSS color derivation from the FROZEN `COLORS` palette in `constants.ts`. Hard rule:
 * "COLORS comes from constants.ts — use it, do not redefine colours." `COLORS` values are RGBA
 * 0-1 float tuples (canvas-renderer-shaped, per T-04's own use of them) — this converts one to a
 * CSS `rgba()` string at call time, so every HUD color that has a real `COLORS` entry is derived
 * from the frozen source, not hand-transcribed (unlike T-08's `tokens.css`, which hand-transcribes
 * two accents in hex with a comment pointing at the source line — this achieves the same "don't
 * redefine" goal structurally instead, since hud.css can't `@import` a `.ts` const any more than
 * tokens.css could).
 */

import { COLORS } from "@swingby/core";

export type ColorKey = keyof typeof COLORS;

export function cssRgba(key: ColorKey, alphaOverride?: number): string {
  const tuple = COLORS[key];
  const r = Math.round(tuple[0] * 255);
  const g = Math.round(tuple[1] * 255);
  const b = Math.round(tuple[2] * 255);
  const a = alphaOverride ?? tuple[3];
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
