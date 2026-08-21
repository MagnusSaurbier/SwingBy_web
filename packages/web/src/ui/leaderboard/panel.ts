// Leaderboard UI, completion-panel surface. Presentational only — this module never calls
// `fetch` itself; it renders whatever `LeaderboardEntry[]` it's handed, which must already have
// passed `net/validate.ts`'s `parseLeaderboardEntries` (the "never trust the server's shape"
// boundary lives in exactly one place, not duplicated per renderer).
//
// XSS: every text value (`name` above all — usernames are free text rendered on a public page)
// goes through `h()`'s string-child path, which uses `Element.append(string)` — the DOM spec
// converts a string argument to a `Text` node, never parsed as markup. There is no `innerHTML`
// anywhere in this file. A name like `<img src=x onerror=alert(1)>` renders as the visible
// literal text `<img src=x onerror=alert(1)>`, not an image tag — proved in
// ui-leaderboard.test.ts by asserting `.textContent` equals the raw string AND that the row
// contains no `<img>` element.
//
// Wired in via `ui/screens/play.ts` (completion panel) and `ui/screens/levelSelect.ts` (world-best
// card adornment, through `worldBest.ts`).

import type { LeaderboardEntry } from "../../net/index.js";
import { h, fromMarkup } from "../dom.js";
import { formatMs } from "../view-models.js";
import { iconMarkup } from "../icons.js";
import "./leaderboard.css";

export type LeaderboardPanelStatus = "loading" | "loaded" | "offline";

export interface LeaderboardPanelState {
  status: LeaderboardPanelStatus;
  /** Already validated (see module header) — this component does not re-check shape, only
   *  renders. Order is preserved exactly as given (never re-sorted here — mirrors the server's
   *  ordering). */
  entries: LeaderboardEntry[];
  /** When present, the row with this `rank` (if it's in `entries`) gets a "you" highlight —
   *  intended for "your rank" on the completion panel. */
  highlightRank?: number;
}

export interface LeaderboardPanelHandle {
  el: HTMLElement;
  update(state: LeaderboardPanelState): void;
  destroy(): void;
}

function verifiedBadge(): HTMLElement {
  return h(
    "span",
    {
      class: "sb-lb-verified",
      title: "Server-verified run",
      "aria-label": "Verified",
    },
    [fromMarkup(iconMarkup("check"))],
  );
}

function row(entry: LeaderboardEntry, highlightRank?: number): HTMLElement {
  const isYou = highlightRank !== undefined && entry.rank === highlightRank;
  return h(
    "li",
    {
      class: `sb-lb-row${isYou ? " sb-lb-row-you" : ""}${entry.verified ? "" : " sb-lb-row-unverified"}`,
    },
    [
      h("span", { class: "sb-lb-rank" }, [`#${entry.rank}`]),
      // `entry.name` is a plain string child of h() -> Element.append(string) -> a Text node.
      // Never parsed as markup, regardless of content (see module header).
      h("span", { class: "sb-lb-name" }, [entry.name]),
      entry.verified ? verifiedBadge() : null,
      h("span", { class: "sb-lb-time" }, [formatMs(entry.timeMs)]),
      h("span", { class: "sb-lb-boost" }, [`${formatMs(entry.boostMs)} boost`]),
    ],
  );
}

function renderBody(state: LeaderboardPanelState): HTMLElement {
  if (state.status === "loading") {
    return h("p", { class: "sb-lb-status" }, ["Loading leaderboard…"]);
  }
  if (state.status === "offline") {
    // No icon here deliberately: T-08's "info" glyph (ui/icons.ts) is drawn for stroke rendering
    // but isn't in that module's own STROKE_ICONS allowlist, so iconMarkup("info") renders filled
    // (a solid dot, its inner line invisible) — confirmed visually against a real screenshot
    // (notes/T-13-PODIUM/log.md). `icons.ts` is T-08's owned file, not mine to fix; the offline
    // note reads clearly as plain text without an icon, so this sidesteps the quirk rather than
    // shipping a visibly broken glyph.
    return h("p", { class: "sb-lb-status sb-lb-offline" }, [
      "Offline — showing your personal bests only.",
    ]);
  }
  if (state.entries.length === 0) {
    return h("p", { class: "sb-lb-status" }, ["No scores yet — be the first."]);
  }
  return h(
    "ol",
    { class: "sb-lb-list" },
    state.entries.map((e) => row(e, state.highlightRank)),
  );
}

export function mountLeaderboardPanel(
  initial: LeaderboardPanelState,
  opts: { title?: string } = {},
): LeaderboardPanelHandle {
  const root = h("div", { class: "sb-lb-panel" });
  const heading = opts.title
    ? h("h3", { class: "sb-lb-title" }, [opts.title])
    : null;
  if (heading) root.append(heading);

  let bodyEl = renderBody(initial);
  root.append(bodyEl);

  function update(state: LeaderboardPanelState): void {
    const next = renderBody(state);
    bodyEl.replaceWith(next);
    bodyEl = next;
  }

  return {
    el: root,
    update,
    destroy(): void {
      root.remove();
    },
  };
}
