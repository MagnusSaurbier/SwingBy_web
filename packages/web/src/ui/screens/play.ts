// T-08 BRIDGE — Play route. Wires the REAL game together: T-05's `createSession`, T-06's
// `createInputSource`, T-07's `createAudio`, T-09's `mountGauge`, T-13's leaderboard queue/panel.
//
// (Superseded scope note: an earlier version of this file was a deliberate chrome-only
// placeholder — see the log's original "Scope boundary" entry — because the original T-08 task's
// DoD forbade importing `game/loop.ts`/`render/` and no other task had yet landed `hud/**` to
// receive the wiring. The coordinator's integration-pass follow-up explicitly supersedes that:
// "make it actually playable... wire the real modules into the play route." This file is that
// wiring. See notes/T-08-BRIDGE/log.md's 2026-08-15T11:10Z entry for the design decisions below.)
//
// Audio-gesture gate (INTERFACES.md: "createAudio() must not construct an AudioContext until the
// first user gesture"): `createAudio()` itself defers construction lazily until one of its four
// methods is called, but `session.start()` calls those unconditionally on the very first frame —
// so the actual constraint is on the CALLER: don't call `session.start()` until a real user
// gesture has happened on this page load. This route always shows a "Ready" pre-flight panel
// (level name/author + a Start button) before constructing ANYTHING — InputSource, AudioSink, and
// GameSession are all built inside that button's click handler. This covers both entry paths
// (a level-select click-through AND a cold-load deep link, which has no prior gesture at all)
// uniformly, without needing to detect which one happened.

import type { Level } from "@swingby/core";
import { BUILTIN_LEVELS, customLevelId, levelId } from "@swingby/core";
import { createSession, type GameSession } from "../../game/loop.js";
import { createInputSource, type InputSource } from "../../game/input.js";
import { createAudio, type AudioSink } from "../../game/audio.js";
import { mountGauge, type GaugeHandle } from "../../hud/index.js";
import "../../hud/hud.css";
import {
  mountLeaderboardPanel,
  type LeaderboardPanelHandle,
} from "../leaderboard/panel.js";
import { buildPath } from "../router.js";
import { backLink, iconedButton } from "../chrome.js";
import { fromMarkup, h } from "../dom.js";
import { iconMarkup } from "../icons.js";
import { beatsPersonalBest, resolveLevel } from "../view-models.js";
import type { ScreenCtx, ScreenResult } from "../screen.js";

export interface PlayMeta {
  /** "Stage 08" for a built-in level, "Custom" for a locally-saved one, "Shared" for a fetched one. */
  label: string;
  /** `levelId(index)` / `customLevelId(level)` / `shared:<shareId>` — the key `storage.getBest`
   *  and the leaderboard both key off. */
  levelKey: string;
  /** Custom AND shared levels are both ineligible for leaderboard submission — neither has a
   *  stable server-recognized built-in id. */
  isCustom: boolean;
  /** Present only for built-in levels with a next stage. */
  nextHref?: string;
  /**
   * Where "open this level in the editor" should navigate — `/editor/<levelKey>`.
   *
   * Optional, and that is the scope boundary made structural rather than checked: a shared level
   * (`/l/:shareId`, mounted through `mountPlayLevel` by `sharedPlaceholder.ts`) is fetched at
   * runtime and has no local id, so no `/editor/:levelId` URL can name it. `sharedPlaceholder.ts`
   * simply never sets this field and therefore needed no edit at all; the feature is inert there
   * because it is unaddressable, not because something remembered to check.
   *
   * Currently written by `renderPlay` and not yet read: the hotkey listener and the settings entry
   * point that consume it are deliberately not built yet, pending two product decisions (whether
   * the binding may be a modifier chord, and where "reachable in settings" points). See
   * notes/feat-edit-current-level/PLAN.md §10.
   */
  editHref?: string;
  /** Where "Back to level select" / the in-game menu's Settings return-to should point. Defaults
   *  to the current route; overridden by `sharedPlaceholder.ts` since a fetched level's route
   *  (`/l/:shareId`) re-fetches on return, which is a known, logged limitation. */
  backHref: string;
}

export function renderPlay(ctx: ScreenCtx): ScreenResult {
  const levelIdParam = ctx.params.levelId ?? "";
  const customs = ctx.storage.listCustomLevels();
  const resolved = resolveLevel(levelIdParam, customs);

  if (!resolved) {
    const el = h("main", { class: "screen placeholder-screen" }, [
      h("h1", {}, ["Level not found"]),
      h("p", { class: "subtitle" }, [`No level matches "${levelIdParam}".`]),
      backLink("/levels", "Back to level select"),
    ]);
    return { el };
  }

  const { level, index, isCustom } = resolved;
  const nextHref =
    !isCustom && index + 1 < BUILTIN_LEVELS.length
      ? buildPath("/play/:levelId", { levelId: levelId(index + 1) })
      : undefined;

  return mountPlayLevel(ctx, level, {
    label: isCustom ? "Custom" : `Stage ${String(index + 1).padStart(2, "0")}`,
    levelKey: levelIdParam,
    isCustom,
    nextHref,
    editHref: buildPath("/editor/:levelId", { levelId: levelIdParam }),
    backHref: "/levels",
  });
}

/**
 * The actual mounting logic, factored out so `sharedPlaceholder.ts` (a fetched level, no local
 * index) can reuse the exact same gameplay path rather than a second implementation. Exported for
 * exactly that reuse.
 */
export function mountPlayLevel(
  ctx: ScreenCtx,
  level: Level,
  meta: PlayMeta,
): ScreenResult {
  const el = h("main", { class: "screen play-screen" });
  const cleanupFns: Array<() => void> = [];

  function renderReady(): void {
    const startBtn = iconedButton("button", "play", "Start Flight", {
      type: "button",
      class: "btn btn-primary",
    });
    startBtn.addEventListener("click", startFlight, { once: true });
    el.replaceChildren(
      h("div", { class: "panel screen-shell play-ready" }, [
        h("div", { class: "screen-header" }, [
          h("h1", {}, [level.name]),
          h("p", { class: "subtitle" }, [`${meta.label} · by ${level.author}`]),
        ]),
        h("div", { class: "play-ready-actions" }, [startBtn]),
        backLink(meta.backHref, "Back to level select"),
      ]),
    );
  }

  function startFlight(): void {
    const chrome = h("div", { class: "play-chrome play-chrome-flight" });
    const canvas = h("canvas", {
      class: "play-canvas",
      "data-swingby-game-mount": "true",
      "aria-hidden": "true",
    }) as HTMLCanvasElement;
    const canvasWrap = h("div", { class: "play-canvas-wrap" }, [canvas]);
    el.replaceChildren(chrome, canvasWrap);

    const settings = ctx.storage.getSettings();

    // Two InputSource instances, deliberately — see the log's design decision #1. `loop.ts`'s own
    // `frame()` is the ONLY consumer of `gameplayInput.drainEvents()` (called internally via
    // `session.start()`/`createSession`) and it explicitly drops "menu"/"toggleFps"/
    // "toggleHighscores" — those three need a second, independent instance to observe at all.
    // Both attach to `document.body` (not `canvasWrap`) so keyboard capture works regardless of
    // where focus happens to be on the page, matching settings.ts's own established pattern.
    const gameplayInput: InputSource = createInputSource(document.body);
    const uiInput: InputSource = createInputSource(document.body);
    uiInput.setBindings(settings.controls);

    const audio: AudioSink = createAudio();

    const session: GameSession = createSession({
      level,
      canvas,
      input: gameplayInput,
      audio,
      settings,
    });

    // Captured BEFORE the run so the leaderboard-submission gate (see below) can independently
    // recompute "did this beat the player's own prior best" without a second `recordBest()` call —
    // `complete.ts` (T-09) already owns the one real call; see the log's design decision #3.
    const prevBest = ctx.storage.getBest(meta.levelKey);

    const gauge: GaugeHandle = mountGauge({
      session,
      level,
      levelLabel: meta.label,
      levelKey: meta.levelKey,
      storage: ctx.storage,
      onSettings: () => {
        ctx.navigate("/settings", {
          state: { returnTo: ctx.router.current() },
        });
      },
      onChooseLevel: () => ctx.navigate("/levels"),
      onMainMenu: () => ctx.navigate("/"),
      onNext: meta.nextHref
        ? () => ctx.navigate(meta.nextHref as string)
        : undefined,
    });
    canvasWrap.append(gauge.el);

    // Menu access (both the on-screen button below AND the "menu" edge action further down) is
    // only meaningful while playing or already paused — gating both the same way prevents the
    // pause panel from stacking on top of the complete/reset overlay. This was a real bug the
    // browser verification pass caught: an earlier version only gated the on-screen button's
    // `hidden` state, so pressing the bound "menu" key (Escape) right as a run auto-completed
    // still opened the pause dialog underneath the completion panel, blocking clicks on both. See
    // notes/T-08-BRIDGE/log.md.
    let menuAccessAllowed = false;

    // --- On-screen Menu trigger (mouse/touch — Backspace/Escape already work via the session +
    // uiInput below). Lives in the chrome bar ABOVE the canvas, deliberately outside the touch
    // zones (see design decision #1 / hud.css's own "keep interactive things out of the thumb
    // zones" note) so it can never be mistaken for a boost/brake tap.
    const menuBtn = iconedButton("button", "pause", "Menu", {
      type: "button",
      class: "btn btn-ghost",
    });
    menuBtn.addEventListener("click", () => {
      if (menuAccessAllowed) gauge.pause.open();
    });
    chrome.append(menuBtn);

    // --- Leaderboard listing (T-13). Shown only once the run completes — see design decision #4
    // for why "offline" is driven by `navigator.onLine` rather than anything `Api.leaderboard()`
    // itself exposes (it degrades every failure to `[]`, indistinguishable from "genuinely empty").
    //
    // Deliberately NOT appended inside `canvasWrap`. It was originally a fourth absolutely-positioned
    // layer stacked on top of the canvas, bottom-anchored, on the assumption (stated in the old CSS
    // comment) that it would "never compete with hud/complete.ts's vertically-centered completion
    // modal". That assumption was false: the completion modal's height grows with its content
    // (rank line, NEW BEST badges, 1-3 buttons), and once it grows past the leaderboard's bottom
    // anchor the two absolutely-positioned overlays silently overlapped — found by actually looking
    // at a "populated leaderboard" screenshot: the completion panel's Retry/Level select buttons
    // were hidden entirely behind the leaderboard rows. Fixed by taking the leaderboard out of the
    // absolute-position stack: it's now a normal sibling of `canvasWrap`, appended below it in
    // document flow, so it can never overlap anything above it regardless of either panel's
    // content height. See `.play-leaderboard` in styles/screens.css and the log's bug entry.
    const lbPanel: LeaderboardPanelHandle = mountLeaderboardPanel(
      { status: "loading", entries: [] },
      { title: "World Leaderboard" },
    );
    lbPanel.el.classList.add("play-leaderboard");
    el.append(lbPanel.el);

    function refreshLeaderboard(): void {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        lbPanel.update({ status: "offline", entries: [] });
        return;
      }
      lbPanel.update({ status: "loading", entries: [] });
      void ctx.api.leaderboard(meta.levelKey, "fastest").then((entries) => {
        lbPanel.update({ status: "loaded", entries });
      });
    }

    let lbVisible = false;
    const unsubLb = session.subscribe((snap) => {
      const shouldShow = snap.status === "complete";
      if (shouldShow === lbVisible) return;
      lbVisible = shouldShow;
      lbPanel.el.classList.toggle("play-leaderboard-visible", shouldShow);
      if (shouldShow) refreshLeaderboard();
    });

    const unsubMenuVisibility = session.subscribe((snap) => {
      menuAccessAllowed = snap.status === "playing" || snap.status === "paused";
      menuBtn.hidden = !menuAccessAllowed;
    });

    // --- Touch zones (T-06's `attachTouch`, "for phones" per the coordinator's own list): right
    // half of the canvas = boost, left half = brake — the common twin-zone convention for a
    // boost/brake-only game. Recomputed on resize since the canvas is fluid-sized.
    function computeTouchZones(): void {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const midX = rect.left + rect.width / 2;
      gameplayInput.attachTouch({
        brake: new DOMRect(rect.left, rect.top, rect.width / 2, rect.height),
        boost: new DOMRect(midX, rect.top, rect.width / 2, rect.height),
      });
    }
    computeTouchZones();
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(computeTouchZones)
        : null;
    resizeObserver?.observe(canvas);
    window.addEventListener("resize", computeTouchZones);

    // --- UI-level edge actions (menu/toggleFps/toggleHighscores), drained once per rendered frame
    // by piggybacking on the session's own per-frame subscribe notification — see design decision #1.
    const unsubUiEdges = session.subscribe(() => {
      for (const action of uiInput.drainEvents()) {
        if (action === "menu") {
          if (menuAccessAllowed) gauge.pause.open();
        } else if (action === "toggleFps") {
          const s = ctx.storage.getSettings();
          ctx.storage.setSettings({ showFps: !s.showFps });
          gauge.hud.refreshSettings();
        } else if (action === "toggleHighscores") {
          const s = ctx.storage.getSettings();
          ctx.storage.setSettings({ showHighscores: !s.showHighscores });
          gauge.hud.refreshSettings();
        }
        // restart/pause: already handled inside loop.ts itself for the GAMEPLAY input instance.
        // uiInput seeing its own copy of the same keydown (both instances listen independently)
        // is harmless — nothing here acts on those two actions a second time.
      }
    });

    // --- Leaderboard rank submission (T-13 wiring note #2, results/T-13-PODIUM.md) — only for a
    // genuine built-in level (never custom/shared — see design decision #3), only when the run
    // beat the player's own prior personal best. Never blocks the completion panel on the network:
    // `queue.submit()` returns synchronously, and `setRank({status:"loading"})` renders immediately
    // while the real submission happens in the background.
    session.onComplete((payload) => {
      if (meta.isCustom) return;
      if (!beatsPersonalBest(prevBest, payload)) return;
      gauge.complete.setRank({ status: "loading" });
      const submissionId = ctx.queue.submit({
        levelId: meta.levelKey,
        metric: "fastest",
        timeMs: payload.timeMs,
        boostMs: payload.boostMs,
        name: ctx.storage.getSettings().username,
        tape: payload.tape,
      });
      const unsubQueue = ctx.queue.subscribe((event) => {
        if (event.id !== submissionId) return;
        if (event.status === "succeeded") {
          gauge.complete.setRank({ status: "loaded", rank: event.rank });
          unsubQueue();
        } else if (event.status === "rejected" || event.status === "dropped") {
          gauge.complete.setRank({ status: "error" });
          unsubQueue();
        }
        // "queued"/"submitting"/"rate-limited"/"retry-scheduled": stays at "loading" — still
        // trying, never surfaced as an error while a retry is still scheduled.
      });
      cleanupFns.push(unsubQueue);
    });

    // The actual gesture-gated start. Everything above only BUILDS objects; this is the first call
    // that can touch AudioContext (via chime("levelStart") inside resetAttempt(false)) — and it
    // runs synchronously inside the Start button's click handler, i.e. inside a real user gesture.
    session.start();

    cleanupFns.push(
      () => unsubLb(),
      () => unsubMenuVisibility(),
      () => unsubUiEdges(),
      () => resizeObserver?.disconnect(),
      () => window.removeEventListener("resize", computeTouchZones),
      () => session.destroy(),
      () => gauge.destroy(),
      () => lbPanel.destroy(),
      () => gameplayInput.destroy(),
      () => uiInput.destroy(),
      () => audio.destroy(),
    );
  }

  renderReady();

  return {
    el,
    destroy(): void {
      for (const fn of cleanupFns) fn();
    },
  };
}
