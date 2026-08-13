/**
 * TEMPORARY fallback implementations of `levelId()` and `customLevelId()`.
 *
 * T-03 ATLAS owns the canonical versions of both in `packages/core/src/level.ts`. As of this
 * writing that file DOES export them, but the package barrel (`packages/core/src/index.ts`, i.e.
 * what an `import ... from "@swingby/core"` actually resolves against) does not yet re-export
 * `level.ts` — confirmed empirically with a throwaway `tsc --noEmit` probe, not just by reading
 * index.ts (see notes/T-10-VAULT/log.md, session 2). So this shim stays for now.
 *
 * TODO(T-03 ATLAS): once `packages/core/src/index.ts` re-exports `level.ts`, delete this file and
 * switch every import below to:
 *
 *   import { levelId, customLevelId } from "@swingby/core";
 *
 * Both functions below are written to be BEHAVIOUR-IDENTICAL to the landed
 * `packages/core/src/level.ts` implementation (confirmed by reading its exported function bodies,
 * lines ~351-390, slightly beyond a pure existence check — see the log for why: the id format has
 * two genuine ambiguities that INTERFACES.md doesn't pin down, an off-by-one in `levelId`'s
 * indexing and which djb2 variant, and getting either wrong would have made the Godot score
 * migration this task owns silently produce the wrong ids). Do not let this file drift into a
 * permanent second implementation — it exists only to unblock this task's own tests.
 */

import type { Level } from "@swingby/core";

/**
 * Matches `packages/core/src/level.ts`'s `levelId`: 0-indexed, 2-digit zero-padded, hyphenated.
 * `levelId(4) === "builtin-04"`, which is also the direct migration target for Godot's
 * `DataManager.score_key` output `"builtin_4"` (see reference/godot/scripts/DataManager.gd:62-65).
 */
export function fallbackLevelId(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`fallbackLevelId: index must be a non-negative integer, got ${index}`);
  }
  return `builtin-${String(index).padStart(2, "0")}`;
}

function slug(name: string): string {
  const cleaned = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "level";
}

/**
 * djb2 string hash (additive variant: `hash = hash * 33 + c`, kept in 32-bit signed range),
 * returned as unsigned base-36. Matches `packages/core/src/level.ts`'s implementation exactly.
 */
function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33 + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Matches `packages/core/src/level.ts`'s `customLevelId`:
 * `slug(name) + "-" + djb2(JSON.stringify(level))` (INTERFACES.md "Custom level ids").
 */
export function fallbackCustomLevelId(level: Level): string {
  return `${slug(level.name)}-${djb2(JSON.stringify(level))}`;
}
