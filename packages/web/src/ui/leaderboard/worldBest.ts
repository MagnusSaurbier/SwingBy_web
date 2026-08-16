// T-13 PODIUM — deliverable 3: level-select adornment. tasks/T-13-PODIUM.md "Where it appears":
// "Level select | Optional world-best per level next to your personal best."
//
// T-08 BRIDGE owns `ui/screens/levelSelect.ts` and its `levelCard()` builds a plain `string[]`
// `meta` array joined with " · " (read directly — see notes/T-13-PODIUM/log.md). Rather than a
// DOM component that screen would have to import from a subtree it doesn't own the rendering
// pipeline of, this exports a pure string-formatting function that slots into that EXACT existing
// pattern with a one-line addition — see results/T-13-PODIUM.md for the precise diff the
// orchestrator can hand to that file. A small standalone badge element is also exported for
// contexts that do own their own DOM tree (e.g. a future dedicated per-level leaderboard route).

import type { LeaderboardEntry } from "../../net/index.js";
import { h } from "../dom.js";
import { formatMs } from "../view-models.js";

/** `entries` must already be validated + server-ordered (see panel.ts's header comment) — the
 *  "world best" is simply the first entry, since verified entries always sort first and ascending
 *  by the query's metric (INTERFACES.md: "never outrank verified"). Returns `null` when there's
 *  nothing to show (empty leaderboard, or the caller is offline and passed `[]`) so a caller can
 *  omit the row entirely rather than rendering an empty "World best:" label. */
export function formatWorldBest(
  entries: readonly LeaderboardEntry[],
): string | null {
  const top = entries[0];
  if (!top) return null;
  return `world best ${formatMs(top.timeMs)}`;
}

export function mountWorldBestBadge(
  entries: readonly LeaderboardEntry[],
): HTMLElement | null {
  const label = formatWorldBest(entries);
  if (label === null) return null;
  const top = entries[0] as LeaderboardEntry;
  return h("span", { class: "sb-lb-worldbest" }, [
    label,
    top.verified
      ? h("span", { class: "sb-lb-worldbest-dot", "aria-hidden": "true" }, [])
      : null,
  ]);
}
