/**
 * TEMPORARY fallback implementations of `levelId()` and `customLevelId()`.
 *
 * T-03 ATLAS owns the canonical versions of both (`packages/core/src/level.ts`, not yet
 * landed while T-10 VAULT was implemented — see INTERFACES.md#corelevelts--t-03-atlas). This
 * file exists solely so T-10's own code and tests can run standalone today, per the T-10 task
 * brief: "keep a small clearly-marked local fallback ... Do not reimplement it as a permanent
 * duplicate."
 *
 * TODO(T-03 ATLAS): once `packages/core/src/level.ts` exports `levelId` and `customLevelId`,
 * delete this file and switch every import below to `@swingby/core`:
 *
 *   import { levelId, customLevelId } from "@swingby/core";
 *
 * `fallbackCustomLevelId` already implements the documented canonical rule exactly
 * (`slug(name) + "-" + djb2(JSON.stringify(level))`, INTERFACES.md "Custom level ids"), so the
 * swap should be behaviour-preserving. `fallbackLevelId` matches the example format given in
 * tasks/T-03-ATLAS.md ("builtin-01") but that format is NOT frozen in INTERFACES.md — confirm it
 * against T-03's actual implementation before relying on it beyond this task's own tests.
 */

import type { Level } from "@swingby/core";

/** Matches the "builtin-01" example in tasks/T-03-ATLAS.md: 1-indexed, 2-digit, hyphenated. */
export function fallbackLevelId(index: number): string {
  const n = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0;
  return `builtin-${String(n + 1).padStart(2, "0")}`;
}

function slug(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.length > 0 ? s : "level";
}

/** djb2 string hash, base36. Matches INTERFACES.md's canonical custom-level-id rule. */
function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
    hash |= 0; // keep it a 32-bit int
  }
  // Force unsigned so the base36 text never carries a leading "-".
  return (hash >>> 0).toString(36);
}

export function fallbackCustomLevelId(level: Level): string {
  return `${slug(level.name)}-${djb2(JSON.stringify(level))}`;
}
