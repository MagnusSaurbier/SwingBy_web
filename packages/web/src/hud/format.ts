/**
 * Tick/ms formatting. Single source of truth for the LIVE (pre-completion) time readout's
 * tick->ms conversion, kept bit-for-bit identical to `packages/core/src/replay.ts`'s private
 * `ticksToMs` and `packages/web/src/game/loop.ts`'s own `ticksToMs`
 * (`Math.round(ticks * 1000 / TPS)`) — see notes/archive/T-09-GAUGE/log.md finding #8 and
 * docs/GAME.md §4 ("Durations are integer tick counts internally, ms only at display boundaries").
 *
 * IMPORTANT for callers: once a `CompletionPayload` exists (from `session.onComplete`), display
 * its `timeMs`/`boostMs` fields DIRECTLY — do not recompute them from `elapsedTicks`/`boostTicks`
 * via this module. `ticksToMs` here exists only for the live, still-playing readout, where no
 * payload exists yet. Using the identical formula in both places is what makes the two agree
 * exactly at the moment of capture (notes/archive/T-05-FLYWHEEL/log.md already proved this
 * construction, not just argued it — see its end-to-end `verifyReplay` accept).
 */

import { TPS } from "@swingby/core";

const MS_PER_TICK = 1000 / TPS;

export function ticksToMs(ticks: number): number {
  return Math.round(ticks * MS_PER_TICK);
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * `M:SS.mmm` — the explicit format for this readout (notes/archive/T-09-GAUGE/task.md, Elements
 * table: "Elapsed time | snapshot.elapsedTicks | ticks / TPS, format M:SS.mmm"). Deliberately NOT
 * the original desktop game's `UIBuilder.gd:format_time` (`"%.2fs"`, e.g. "12.34s"); documented
 * here so nobody "fixes" this back to match it by mistake.
 */
export function formatDuration(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const minutes = Math.floor(safeMs / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  const millis = safeMs % 1000;
  return `${minutes}:${pad(seconds, 2)}.${pad(millis, 3)}`;
}
