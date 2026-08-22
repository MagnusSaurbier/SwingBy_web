/**
 * Hint trigger evaluation: `{ condition, text }` with conditions `notBoosted`, `nearBounds`,
 * `nearGoal`. See notes/archive/T-09-GAUGE/log.md findings #1/#2 for why this is built against
 * `GameSnapshot`'s ACTUAL fields (no goal-distance/speed data exists in the shared type contract).
 *
 * The dynamic bounds/not-boosted hint override is available for EVERY level, not gated to a
 * "tutorial" category — `Level` has no `category` field at all — falling back to the level's own
 * authored `hint` (set in the editor), then a static per-name hint, then a generic default.
 * Flagged here as a deliberate design choice so it doesn't read as an unexplained gap.
 */

import type { Level } from "@swingby/core";
import { TPS } from "@swingby/core";
import type { GameStatus } from "../game/loop.js";

export type HintCondition =
  "nearBounds" | "notBoosted" | "nearGoal" | "default";

export interface HintRule {
  readonly condition: HintCondition;
  readonly text: string;
}

/** Exactly the fields a hint rule can condition on — a strict subset of `GameSnapshot`, named
 *  separately so this module never silently grows a dependency on fields that don't exist yet
 *  (see the module doc comment on `nearGoal`). */
export interface HintContext {
  status: GameStatus;
  elapsedTicks: number;
  boostTicks: number;
  boundsWarning: number;
  reachedGoal: boolean;
}

/** Ported literally from `GameWorld.gd:944` (`_bounds_warning_level > 0.3`). */
const NEAR_BOUNDS_THRESHOLD = 0.3;

/** Grace period before nagging about boost — Godot's own tutorial hint has no such grace (it reads
 *  `_first_boost_fired` directly, which is false from tick 0), but firing a "hold boost" hint
 *  literally the instant a level loads reads as noise rather than guidance. 2 seconds, own choice,
 *  not ported from anywhere — flagged as an assumption. */
const NOT_BOOSTED_GRACE_TICKS = TPS * 2;

/**
 * First matching rule wins, priority order nearBounds > notBoosted > nearGoal > default — mirrors
 * Godot's own `_tutorial_hint()` checking bounds-warning first, then first-boost, then distance/
 * speed, then a final fallback (GameWorld.gd:944-965). Returns `null` while not actively playing
 * (paused/resetting/complete) — hint chatter about flying too far out is meaningless noise once the
 * sim isn't running, and `complete.ts` owns messaging once `status === "complete"`.
 */
export function evaluateHint(
  rules: readonly HintRule[],
  ctx: HintContext,
): string | null {
  if (ctx.status !== "playing") return null;

  const byCondition = new Map<HintCondition, string>();
  for (const rule of rules) {
    if (!byCondition.has(rule.condition))
      byCondition.set(rule.condition, rule.text);
  }

  if (ctx.boundsWarning > NEAR_BOUNDS_THRESHOLD) {
    const text = byCondition.get("nearBounds");
    if (text) return text;
  }
  if (ctx.boostTicks === 0 && ctx.elapsedTicks > NOT_BOOSTED_GRACE_TICKS) {
    const text = byCondition.get("notBoosted");
    if (text) return text;
  }
  // "nearGoal" is a real condition in the schema (so a per-level rule set can name it without
  // schema churn later) but GameSnapshot carries no goal-distance field for it to key off today —
  // it can never win a match yet. Reserved, not dead code: see the module doc comment.

  return byCondition.get("default") ?? null;
}

// ---------------------------------------------------------------------------
// Ported Godot hint copy (GameWorld.gd:922-965), plus the generic fallback used for the 27 of 33
// built-in levels Godot's own `match current_level_name:` also falls through on.
// ---------------------------------------------------------------------------

const NEAR_BOUNDS_TEXT =
  "Warning: you are flying too far from the system. Steer back or the mission will auto-reset.";

/** "Hold Space to build speed" in Godot literally names the physical key. Bindings are rebindable
 *  in this port (T-06 HELM) and hud/** has no reach into a keycode-label formatter without
 *  importing UI-layer code, so this names the ACTION instead of a physical key — stays correct
 *  regardless of what the player rebound it to. Documented divergence, not an oversight. */
const NOT_BOOSTED_TEXT =
  "Hold Boost to build speed, then let gravity bend your path toward the target.";

const GENERIC_DEFAULT_TEXT =
  "Reach the glowing target with the least thrust you can manage.";

/** GameWorld.gd:922-934, `match current_level_name:`. Keyed by `Level.name` since this port has no
 *  level-index-stable "category" concept to hang tutorial-specific text off (see module doc). */
const NAMED_DEFAULT_TEXT: Readonly<Record<string, string>> = Object.freeze({
  "Orbital Primer": "Press Boost to accelerate into the blue planet's orbit.",
  "Falling Star":
    "Let gravity do the first half of the work, then brake if you dive in too hot.",
  "Blue Transfer": "Tap Brake if you overcook the transfer.",
  "Hidden Pull":
    "Some suns are invisible. Trust the prediction line, or enable Trajectory Prediction in Settings.",
  "Dark Matter Lesson":
    "Some suns are invisible. Trust the prediction line, or enable Trajectory Prediction in Settings.",
  "Twin Arc": "Twin gravity wells reward a gentle slingshot.",
});

/** Every level gets the same dynamic overrides (nearBounds/notBoosted) plus its own static default
 *  — this is "ship the tutorial hints at minimum" satisfied for the whole built-in set, not just
 *  one designated tutorial level (see module doc's "deliberate widening" note). */
export function hintRulesForLevel(level: Level): readonly HintRule[] {
  return [
    { condition: "nearBounds", text: NEAR_BOUNDS_TEXT },
    { condition: "notBoosted", text: NOT_BOOSTED_TEXT },
    {
      condition: "default",
      text:
        level.hint?.trim() ||
        NAMED_DEFAULT_TEXT[level.name] ||
        GENERIC_DEFAULT_TEXT,
    },
  ];
}
