/**
 * Hint text is entirely author-controlled via `Level.hint` (set in the editor, shipped in
 * `packages/core/src/levels.json` for the built-ins). There is no generic/dynamic fallback text
 * (no "Hold Boost to build speed...", no bounds-warning copy, no per-name table) — an unset or
 * blank hint means no hint is shown, ever.
 */

import type { Level } from "@swingby/core";
import type { Settings } from "@swingby/core";
import type { GameStatus } from "../game/loop.js";

const HINT_DISMISSALS_KEY = "hintDismissals";

/** Reads the settings-backed per-level dismissals. Invalid hand-edited data is safely ignored. */
export function isHintDismissed(settings: Settings, levelKey: string): boolean {
  const value = (settings as Record<string, unknown>)[HINT_DISMISSALS_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as Record<string, unknown>)[levelKey] === true;
}

/** A shallow settings patch that preserves dismissals for every other level. */
export function hintDismissalPatch(
  settings: Settings,
  levelKey: string,
): Partial<Settings> {
  const value = (settings as Record<string, unknown>)[HINT_DISMISSALS_KEY];
  const dismissals =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  return { [HINT_DISMISSALS_KEY]: { ...dismissals, [levelKey]: true } } as Partial<Settings>;
}

/** Returns the level's authored hint while actively playing, or `null` otherwise (including when
 *  the level has no hint set). `complete.ts` owns messaging once `status === "complete"`. */
export function evaluateHint(level: Level, status: GameStatus): string | null {
  if (status !== "playing") return null;
  const hint = level.hint?.trim();
  return hint ? hint : null;
}
