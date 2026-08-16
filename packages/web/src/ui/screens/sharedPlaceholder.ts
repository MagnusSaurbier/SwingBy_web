// T-08 BRIDGE — /l/:shareId. Fetches a shared custom level via T-13 PODIUM's `Api.fetchLevel` and
// hands it to the same gameplay-mounting path `/play/:levelId` uses (`mountPlayLevel`), so a shared
// link is genuinely playable, not just a description of one. Per results/T-13-PODIUM.md's wiring
// note #4: "on success: hand `level` to whatever constructs GameSession... on rejection show the
// existing not-found-style message" — `fetchLevel` rejects (never resolves to a failure value) on
// a 404/malformed/unreachable response, so this is a real try/catch, not a status check.
//
// Screens are otherwise synchronous (`ScreenFn` returns a `ScreenResult` immediately); this one
// renders a loading state synchronously, then swaps its own root element for the mounted gameplay
// screen (or an error state) once the fetch settles. `cancelled` guards against acting on a
// response that arrives after the user has already navigated away.

import { fromMarkup, h } from "../dom.js";
import { backLink } from "../chrome.js";
import { iconMarkup } from "../icons.js";
import { mountPlayLevel } from "./play.js";
import type { ScreenCtx, ScreenResult } from "../screen.js";

export function renderSharedPlaceholder(ctx: ScreenCtx): ScreenResult {
  const shareId = ctx.params.shareId ?? "";
  let cancelled = false;
  let innerDestroy: (() => void) | null = null;

  const el = h("main", { class: "screen placeholder-screen" }, [
    fromMarkup(
      iconMarkup("link", { decorative: false, title: "Shared level" }),
    ),
    h("h1", {}, ["Shared level"]),
    h("p", { class: "subtitle" }, ["Loading…"]),
  ]);

  ctx.api
    .fetchLevel(shareId)
    .then((level) => {
      if (cancelled) return;
      const result = mountPlayLevel(ctx, level, {
        label: "Shared",
        levelKey: `shared:${shareId}`,
        // Shared levels are never eligible for leaderboard submission (no built-in/custom id the
        // server recognizes) — same ineligibility as a locally-authored custom level.
        isCustom: true,
        // Deliberately "/levels", not back to this loading screen — see the log's note that
        // returning here from Settings (via the in-game menu, which uses `router.current()`
        // captured live, i.e. still "/l/:shareId") re-fetches from scratch. Documented limitation,
        // not fixed in this pass.
        backHref: "/levels",
      });
      innerDestroy = result.destroy ?? null;
      el.replaceWith(result.el);
    })
    .catch(() => {
      if (cancelled) return;
      el.replaceChildren(
        fromMarkup(
          iconMarkup("link", { decorative: false, title: "Shared level" }),
        ),
        h("h1", {}, ["Level not found"]),
        h("p", { class: "subtitle" }, [
          `This shared level could not be loaded ("${shareId}").`,
        ]),
        backLink("/", "Back to menu"),
      );
    });

  return {
    el,
    destroy(): void {
      cancelled = true;
      innerDestroy?.();
    },
  };
}
