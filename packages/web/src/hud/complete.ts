/**
 * T-09 GAUGE — deliverable 3: level complete panel. Task doc: "time and boost, whether either is a
 * new personal best, and Next / Retry / Level Select. This is also where leaderboard submission
 * surfaces (T-13 PODIUM), so leave a slot for it and do not block the panel on a network call."
 *
 * Wires to `session.onComplete`, registered exactly once at mount — T-05's own interface contract
 * (verified in notes/T-05-FLYWHEEL/log.md: "onComplete must not re-fire on any subsequent frame
 * boundary") is what makes "Completion panel appears exactly once per attempt" hold; this module
 * doesn't add its own re-entrancy guard on TOP of that because there is nothing to guard against —
 * trusting a frozen, already-tested interface rather than defensively duplicating its guarantee.
 *
 * Owns the ONE `storage.recordBest()` call per completion — reading the previous best BEFORE
 * recording (so "previous best" and "is this a new best" both reflect the pre-attempt state), then
 * recording, using T-10's real `{timeIsNew, boostIsNew}` return directly (never recomputed by
 * comparing numbers here, which would risk disagreeing with storage's own comparison rules).
 *
 * Auto-hides whenever `snapshot.status` leaves `"complete"` — covers both this panel's own Retry
 * button (`session.restart()`) AND an external restart (e.g. the bound "restart" key, which
 * `loop.ts`'s edge-event drain honours unconditionally, regardless of what panel is showing).
 */

import type { Level } from "@swingby/core";
import type {
  CompletionPayload,
  GameSession,
  GameSnapshot,
} from "../game/loop.js";
import type { PersonalBest, Storage } from "../storage/index.js";
import { formatDuration } from "./format.js";

/** T-13 PODIUM's slot. `net/index.ts` doesn't exist yet (T-13 hasn't started) — this type is owned
 *  here, structurally compatible with whatever `Api.submitScore` eventually returns, and a future
 *  caller feeds it in via `setRank()` without this module importing anything from `net/`. */
export interface RankSlot {
  status: "unavailable" | "loading" | "loaded" | "error";
  /** Present only when `status === "loaded"`. */
  rank?: number;
}

const RANK_UNAVAILABLE: RankSlot = { status: "unavailable" };

export interface CompletePanelDeps {
  session: GameSession;
  level: Level;
  levelLabel: string;
  /** `levelId(index)` or `customLevelId(level)` — the key `storage.getBest`/`recordBest` expect. */
  levelKey: string;
  storage: Pick<Storage, "getBest" | "recordBest">;
  /** Absent when there is no next level (e.g. the last built-in stage) — the panel hides the "Next"
   *  action entirely rather than rendering it disabled. */
  onNext?: () => void;
  onChooseLevel(): void;
}

export interface CompletePanelHandle {
  el: HTMLElement;
  isOpen(): boolean;
  /** How many times the panel has actually shown itself — test/debug surface for "exactly once per
   *  attempt", not something the panel itself uses to guard re-entry (see module doc). */
  completionCount(): number;
  setRank(slot: RankSlot): void;
  destroy(): void;
}

export function mountCompletePanel(
  deps: CompletePanelDeps,
): CompletePanelHandle {
  const root = document.createElement("div");
  root.classList.add("sb-complete-root");

  let panelEl: HTMLElement | null = null;
  let rankRowEl: HTMLElement | null = null;
  let rankSlot: RankSlot = RANK_UNAVAILABLE;
  let count = 0;

  function rankText(slot: RankSlot): string {
    switch (slot.status) {
      case "unavailable":
        return "";
      case "loading":
        return "Submitting score…";
      case "loaded":
        return slot.rank !== undefined
          ? `Leaderboard rank #${slot.rank}`
          : "Score submitted";
      case "error":
        return "Leaderboard unavailable";
    }
  }

  function statRow(
    label: string,
    valueText: string,
    isNew: boolean,
  ): HTMLElement {
    const row = document.createElement("div");
    row.classList.add("sb-complete-stat");
    const labelEl = document.createElement("span");
    labelEl.classList.add("sb-complete-stat-label");
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.classList.add("sb-complete-stat-value");
    valueEl.textContent = valueText;
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    if (isNew) {
      const badge = document.createElement("span");
      badge.classList.add("sb-complete-badge");
      badge.textContent = "NEW BEST";
      row.appendChild(badge);
    }
    return row;
  }

  function hide(): void {
    if (!panelEl) return;
    panelEl.remove();
    panelEl = null;
    rankRowEl = null;
  }

  function show(
    payload: CompletionPayload,
    result: { timeIsNew: boolean; boostIsNew: boolean },
    previousBest: PersonalBest | null,
  ): void {
    hide();
    count++;
    rankSlot = RANK_UNAVAILABLE;

    const overlay = document.createElement("div");
    overlay.classList.add("sb-complete-overlay");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "sb-complete-title");

    const panel = document.createElement("div");
    panel.classList.add("sb-complete-panel");
    overlay.appendChild(panel);

    const title = document.createElement("h2");
    title.id = "sb-complete-title";
    title.textContent = "Target reached";
    panel.appendChild(title);

    const sub = document.createElement("p");
    sub.classList.add("sb-complete-level");
    sub.textContent = `${deps.levelLabel} · ${deps.level.name}`;
    panel.appendChild(sub);

    panel.appendChild(
      statRow("Time", formatDuration(payload.timeMs), result.timeIsNew),
    );
    panel.appendChild(
      statRow("Boost used", formatDuration(payload.boostMs), result.boostIsNew),
    );

    if (previousBest) {
      const prev = document.createElement("p");
      prev.classList.add("sb-complete-previous");
      prev.textContent = `Previous best: ${formatDuration(previousBest.timeMs)} · ${formatDuration(previousBest.boostMs)} boost`;
      panel.appendChild(prev);
    }

    const rankRow = document.createElement("p");
    rankRow.classList.add("sb-complete-rank");
    rankRow.textContent = rankText(rankSlot);
    rankRow.classList.toggle("sb-hidden", rankSlot.status === "unavailable");
    panel.appendChild(rankRow);
    rankRowEl = rankRow;

    const actions = document.createElement("div");
    actions.classList.add("sb-complete-actions");
    panel.appendChild(actions);

    let primaryBtn: HTMLElement | null = null;

    if (deps.onNext) {
      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.classList.add("btn", "btn-primary");
      nextBtn.textContent = "Next level";
      nextBtn.addEventListener("click", deps.onNext);
      actions.appendChild(nextBtn);
      primaryBtn = nextBtn;
    }

    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.classList.add("btn");
    retryBtn.textContent = "Retry";
    retryBtn.addEventListener("click", () => {
      deps.session.restart();
      hide();
    });
    actions.appendChild(retryBtn);
    primaryBtn ??= retryBtn;

    const levelsBtn = document.createElement("button");
    levelsBtn.type = "button";
    levelsBtn.classList.add("btn");
    levelsBtn.textContent = "Level select";
    levelsBtn.addEventListener("click", deps.onChooseLevel);
    actions.appendChild(levelsBtn);

    root.appendChild(overlay);
    panelEl = overlay;
    primaryBtn.focus();
  }

  deps.session.onComplete((payload: CompletionPayload) => {
    const previousBest = deps.storage.getBest(deps.levelKey);
    const result = deps.storage.recordBest(deps.levelKey, {
      timeMs: payload.timeMs,
      boostMs: payload.boostMs,
    });
    show(payload, result, previousBest);
  });

  let lastStatus: GameSnapshot["status"] | null = null;
  const unsubscribe = deps.session.subscribe((snap: GameSnapshot) => {
    if (snap.status === lastStatus) return;
    lastStatus = snap.status;
    if (snap.status !== "complete") hide();
  });

  return {
    el: root,
    isOpen(): boolean {
      return panelEl !== null;
    },
    completionCount(): number {
      return count;
    },
    setRank(slot: RankSlot): void {
      rankSlot = slot;
      if (rankRowEl) {
        rankRowEl.textContent = rankText(slot);
        rankRowEl.classList.toggle("sb-hidden", slot.status === "unavailable");
      }
    },
    destroy(): void {
      unsubscribe();
      hide();
    },
  };
}
