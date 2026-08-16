// T-08 BRIDGE — pure view-model / logic helpers, deliberately DOM-free so they can be unit tested
// under plain-Node vitest (no jsdom in this repo — see notes/T-08-BRIDGE/log.md). Screens import
// these and only these do the actual DOM rendering.

import type { ControlAction, Level, Settings } from "@swingby/core";
import { BUILTIN_LEVELS, customLevelId, levelId } from "@swingby/core";
import type { PersonalBest, Storage } from "../storage/index.js";

// ---------------------------------------------------------------------------------------------
// Level Select
// ---------------------------------------------------------------------------------------------

export interface LevelCardVM {
  id: string;
  index: number;
  name: string;
  author: string;
  isCustom: boolean;
  completed: boolean;
  best: PersonalBest | null;
}

function toCard(level: Level, index: number, id: string, isCustom: boolean, storage: Pick<Storage, "getBest">): LevelCardVM {
  const best = storage.getBest(id);
  return { id, index, name: level.name, author: level.author, isCustom, completed: best !== null, best };
}

/** Builds the two level-select tabs' worth of view-model data. `customs` is passed in (rather than
 *  read from storage internally) so callers can pass a fixed snapshot for a single render pass. */
export function buildLevelList(
  builtins: readonly Level[],
  customs: readonly Level[],
  storage: Pick<Storage, "getBest">,
): { builtin: LevelCardVM[]; custom: LevelCardVM[] } {
  const builtin = builtins.map((lvl, i) => toCard(lvl, i, levelId(i), false, storage));
  const custom = customs.map((lvl, i) => toCard(lvl, i, customLevelId(lvl), true, storage));
  return { builtin, custom };
}

/**
 * "Play" on the menu resumes at the first incomplete built-in level (task doc: "Play (resumes at
 * first incomplete level)"). Falls back to the first level if every one is complete — there is
 * always something to play, never a dead button.
 */
export function firstIncompleteLevel(
  builtins: readonly Level[],
  storage: Pick<Storage, "getBest">,
): { id: string; index: number } {
  for (let i = 0; i < builtins.length; i++) {
    if (storage.getBest(levelId(i)) === null) {
      return { id: levelId(i), index: i };
    }
  }
  return { id: levelId(0), index: 0 };
}

/** Resolves a `:levelId` route param to a level, checking built-ins first then the caller-supplied
 *  custom list. Returns `null` for an id that matches neither — the Play screen renders a
 *  not-found state rather than throwing. */
export function resolveLevel(
  id: string,
  customs: readonly Level[],
): { level: Level; index: number; isCustom: boolean } | null {
  const builtinIndex = BUILTIN_LEVELS.findIndex((_, i) => levelId(i) === id);
  if (builtinIndex >= 0) {
    return { level: BUILTIN_LEVELS[builtinIndex] as Level, index: builtinIndex, isCustom: false };
  }
  const customIndex = customs.findIndex((l) => customLevelId(l) === id);
  if (customIndex >= 0) {
    return { level: customs[customIndex] as Level, index: customIndex, isCustom: true };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Settings — control rebinding
// ---------------------------------------------------------------------------------------------

/** Human-readable label for a `KeyboardEvent.code` string, for display on a rebind button. Covers
 *  every code any of the 11 default bindings can hold plus the common alternates a player might
 *  rebind to; falls back to the raw code (still meaningful) for anything unrecognised. */
export function codeLabel(code: string): string {
  const table: Record<string, string> = {
    Space: "Space",
    ShiftLeft: "Shift",
    ShiftRight: "Right Shift",
    ControlLeft: "Ctrl",
    ControlRight: "Right Ctrl",
    AltLeft: "Alt",
    AltRight: "Alt",
    Backspace: "Backspace",
    Escape: "Esc",
    Enter: "Enter",
    Tab: "Tab",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
  };
  const known = table[code];
  if (known) return known;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  return code;
}

/** Result of feeding a captured keydown into the pending-rebind state machine. `cancel: true`
 *  means Escape was pressed — abandon the rebind, restore the previous label. Otherwise `code` is
 *  the new binding to apply. Pure — no DOM, no side effects — so the capture policy (which keys
 *  cancel, which are accepted) is unit-testable independent of how the listener is wired up. */
export function resolveRebindKey(event: { code: string }): { cancel: true } | { cancel: false; code: string } {
  if (event.code === "Escape") return { cancel: true };
  return { cancel: false, code: event.code };
}

export const CONTROL_SECTIONS: ReadonlyArray<{ title: string; actions: ReadonlyArray<[ControlAction, string]> }> = [
  {
    title: "Flight controls",
    actions: [
      ["boost", "Boost engine"],
      ["brake", "Brake / decelerate"],
      ["thrustUp", "Thrust up"],
      ["thrustDown", "Thrust down"],
      ["thrustLeft", "Thrust left"],
      ["thrustRight", "Thrust right"],
    ],
  },
  {
    title: "Session controls",
    actions: [
      ["restart", "Restart level"],
      ["pause", "Pause / resume"],
      ["menu", "Open menu"],
      ["toggleFps", "Toggle FPS counter"],
      ["toggleHighscores", "Toggle personal bests"],
    ],
  },
];

export const DISPLAY_TOGGLES: ReadonlyArray<{ key: keyof Settings; label: string; description: string }> = [
  { key: "trail", label: "Flight trail", description: "Paint your path through space as you fly." },
  { key: "showFuture", label: "Trajectory prediction", description: "See a ghost of where your ship is heading." },
  { key: "showForceVector", label: "Gravity vector", description: "Visualize the gravitational pull on your ship." },
  { key: "showTimes", label: "Time display", description: "Track mission time and cumulative thrust burn." },
  { key: "showHighscores", label: "Personal bests", description: "Show your fastest run records mid-flight." },
  { key: "showFps", label: "Performance monitor", description: "Display FPS and physics tick rate." },
];

// ---------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------

/** `12345` ms -> "12.345s". Matches the ms-at-boundary convention (PROJECT.md §4: ticks
 *  internally, ms only at display boundaries) — this IS a display boundary. */
export function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(3)}s`;
}

// ---------------------------------------------------------------------------------------------
// Play — leaderboard submission eligibility
// ---------------------------------------------------------------------------------------------

/**
 * Did `attempt` beat `prev` on at least one metric? Mirrors `storage/index.ts`'s own `recordBest`
 * comparison exactly (`timeIsNew = !existing || r.timeMs < existing.timeMs`, OR'd with the boost
 * equivalent) — deliberately NOT calling `storage.recordBest()` a second time to find this out.
 * `complete.ts` (T-09 GAUGE) already owns the one real `recordBest()` call per completion; this is
 * an independent, read-only recomputation of the same boolean against a `prev` best captured
 * before the attempt started, used purely to gate whether a score is worth submitting to the
 * leaderboard at all (see `ui/screens/play.ts`). No prior best (`prev === null`) always counts as
 * a beat — the very first completion of a level is always worth submitting.
 */
export function beatsPersonalBest(
  prev: PersonalBest | null,
  attempt: { timeMs: number; boostMs: number },
): boolean {
  if (!prev) return true;
  return attempt.timeMs < prev.timeMs || attempt.boostMs < prev.boostMs;
}
