/**
 * Hint text is entirely author-controlled via `Level.hint` (set in the editor, shipped in
 * `packages/core/src/levels.json` for the built-ins). There is no generic/dynamic fallback text
 * (no "Hold Boost to build speed...", no bounds-warning copy, no per-name table) — an unset or
 * blank hint means no hint is shown, ever.
 */

import type { Level } from "@swingby/core";
import type { GameStatus } from "../game/loop.js";

/** Returns the level's authored hint while actively playing, or `null` otherwise (including when
 *  the level has no hint set). `complete.ts` owns messaging once `status === "complete"`. */
export function evaluateHint(level: Level, status: GameStatus): string | null {
  if (status !== "playing") return null;
  const hint = level.hint?.trim();
  return hint ? hint : null;
}
