/**
 * T-05 FLYWHEEL — world bounds: the warning ramp, the reset countdown, and the reset flash.
 *
 * Mirrors `GameWorld._check_world_bounds` (reference/godot/scripts/GameWorld.gd:694-717) plus the
 * countdown-decrement/expiry half of `_process` (GameWorld.gd:400-408). See
 * notes/T-05-FLYWHEEL/log.md for the full reasoning; the short version:
 *
 * - The ratio is measured from a FIXED world-space origin (0, 0), matching
 *   `packages/core/src/physics.ts`'s own `TickResult.outOfBounds` check (T-01's documented decision
 *   — physics.ts:340-352, notes/T-01-KEPLER/log.md:107-149) — NOT Godot's window-size-dependent
 *   `world_origin`, which has no meaningful equivalent in a pure/portable module and would disagree
 *   with `outOfBounds` if reproduced differently here. Keeping the two in lockstep is the point: the
 *   warning ramp reaching 1.0 and `outOfBounds` becoming true happen at exactly the same position.
 * - The 0.65s grace countdown before a forced reset is armed per SIMULATED TICK (fresh position each
 *   time) but decremented per RENDERED FRAME using wall-clock `dt` — exactly like Godot, where
 *   `_check_world_bounds` runs inside `_physics_tick` (tick-rate) but the timer decrement runs in
 *   `_process` (frame-rate). Physics keeps running normally during this countdown; only the actual
 *   reset (once the countdown reaches zero) is a hard cut.
 */

import {
  BOUNDS_WARNING_DURATION,
  BOUNDS_WARNING_START_RATIO,
  MAX_WORLD_BOUNDS_X,
  MAX_WORLD_BOUNDS_Y,
  RESET_FLASH_DURATION,
} from "@swingby/core";

export interface BoundsState {
  /** Seconds remaining before an in-progress out-of-bounds excursion forces a reset. 0 = not counting. */
  warningTimer: number;
  /** Seconds remaining in the post-reset cosmetic flash. 0 = no flash in progress. */
  flashRemaining: number;
}

export function createBoundsState(): BoundsState {
  return { warningTimer: 0, flashRemaining: 0 };
}

export function resetBoundsState(state: BoundsState): void {
  state.warningTimer = 0;
  state.flashRemaining = 0;
}

/**
 * How far outside the `[-MAX_WORLD_BOUNDS_X, MAX_WORLD_BOUNDS_X] x [-MAX_WORLD_BOUNDS_Y, ...]`
 * rectangle a point is, as a ratio: 0 at the origin, 1 exactly on the boundary, >1 outside it.
 * `Math.max` of the two axis ratios — same shape as `GameWorld._check_world_bounds`'s
 * `maxf(x_ratio, y_ratio)` (GameWorld.gd:707), just measured from (0,0) instead of `world_origin`.
 */
export function boundsRatio(x: number, y: number): number {
  return Math.max(
    Math.abs(x) / MAX_WORLD_BOUNDS_X,
    Math.abs(y) / MAX_WORLD_BOUNDS_Y,
  );
}

/**
 * 0..1 warning intensity, ramping linearly from `BOUNDS_WARNING_START_RATIO` (0.8) up to a full
 * exit (ratio 1.0). Mirrors `GameWorld.gd:708-711`. Feeds both `RenderFrame.boundsWarning` (edge
 * glow) and `AudioSink.setAlarm`, and `GameSnapshot.boundsWarning`.
 */
export function boundsWarningLevel(ratio: number): number {
  if (ratio < BOUNDS_WARNING_START_RATIO) return 0;
  const level =
    (ratio - BOUNDS_WARNING_START_RATIO) / (1 - BOUNDS_WARNING_START_RATIO);
  return Math.min(1, Math.max(0, level));
}

/**
 * Arms or cancels the reset countdown. Call once per SIMULATED TICK with that tick's fresh
 * `boundsRatio`. Mirrors `GameWorld.gd:712-716`: starts the countdown the instant the ratio first
 * exceeds 1 (and only if it isn't already counting — re-arming would extend the grace period every
 * tick the player stays out, which Godot does not do), cancels it the moment the player is back
 * in-bounds.
 */
export function updateBoundsWarning(state: BoundsState, ratio: number): void {
  if (ratio > 1) {
    if (state.warningTimer <= 0) state.warningTimer = BOUNDS_WARNING_DURATION;
  } else {
    state.warningTimer = 0;
  }
}

/**
 * Decrements the reset countdown by one (already frame-clamped) wall-clock `dt`. Returns true
 * exactly on the frame the countdown reaches zero — the caller's cue to actually perform the reset.
 * No-op (returns false) when the countdown isn't running. Mirrors `GameWorld.gd:402-408`.
 */
export function tickBoundsCountdown(state: BoundsState, dt: number): boolean {
  if (state.warningTimer <= 0) return false;
  state.warningTimer = Math.max(0, state.warningTimer - dt);
  return state.warningTimer <= 0;
}

/** Starts the reset-flash cosmetic countdown. Call whenever an attempt resets — manual `restart()`
 *  or the bounds countdown expiring. */
export function startResetFlash(state: BoundsState): void {
  state.flashRemaining = RESET_FLASH_DURATION;
}

/**
 * Advances the flash countdown by one (already frame-clamped) wall-clock `dt`. Returns the 0..1
 * progress for `RenderFrame.flash` (1 = just triggered, ramping down to 0 as it fades / not
 * resetting at all).
 */
export function tickResetFlash(state: BoundsState, dt: number): number {
  if (state.flashRemaining <= 0) return 0;
  state.flashRemaining = Math.max(0, state.flashRemaining - dt);
  return flashProgress(state);
}

/** Reads the current 0..1 flash progress WITHOUT advancing the countdown — for `buildFrame()` call
 *  sites that need the value on frames that don't themselves call `tickResetFlash`. */
export function flashProgress(state: BoundsState): number {
  return state.flashRemaining > 0
    ? state.flashRemaining / RESET_FLASH_DURATION
    : 0;
}
