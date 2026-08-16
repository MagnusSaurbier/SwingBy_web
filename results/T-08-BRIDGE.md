# T-08 BRIDGE — Results

UI shell: app entry, router, six screens. Area `packages/web/src/ui/**` + `main.ts` + `index.html`
+ `packages/web/src/styles/**`. Full working log: [`notes/T-08-BRIDGE/log.md`](../notes/T-08-BRIDGE/log.md).

## Framework choice — plain TypeScript + DOM, hand-rolled router

**No Svelte, no other UI framework or library.** Recorded in full at the top of
[`packages/web/src/main.ts`](../packages/web/src/main.ts) (deliverable 5). Two independent reasons:

1. **Mechanical.** Wiring Svelte in requires an `@sveltejs/vite-plugin-svelte` entry in
   `vite.config.ts` and a new `devDependencies` entry in `packages/web/package.json`. Neither file
   is mine to touch in this session. There's no path to a compiled framework without editing one of
   them.
2. **Budget.** `npm run size` gates the whole initial route (core + render + game + ui combined) at
   250 KB gzip. Plain DOM costs 0 KB of framework runtime — every byte shipped is content. T-04
   AURORA already proved the pattern works at this scale (3.15 KB gzip for a full canvas renderer).

**Measured cost: 15.74 KB gzip for the entire built app** (index.html + CSS + JS), against the
250 KB budget — **234.26 KB of headroom, 93.7% of the budget unused.** Framework choice cost
approximately 0 KB versus "plain DOM" because plain DOM is what was chosen — there is no delta to
justify.

**No `BASE_PATH` constant exists anywhere.** Confirmed:
`grep -rn BASE_PATH packages/web/src packages/web/index.html vercel.json` → the only hit is a
comment in `main.ts` explaining *why* there isn't one. Routes are rooted (`/`, `/levels`, `/play/:id`,
etc.), matching T-14's `vercel.json` SPA rewrite and the "own subdomain" design.

## Deliverables

| # | Artifact | Path | Status |
|---|---|---|---|
| 1 | App entry + router | `packages/web/src/main.ts`, `packages/web/index.html` | Done. Hand-rolled router (`ui/router.ts`) using real `history.pushState`/`popstate`, no hash routing. |
| 2 | Six screens: menu, level select, workshop, settings, credits, in-game menu | `packages/web/src/ui/screens/*.ts` | Done. Plus 3 placeholder routes (`/editor`, `/l/:shareId`, not-found) so every path resolves — see "Scope notes" below. |
| 3 | Stylesheet + design tokens from `COLORS` | `packages/web/src/styles/{tokens,base,components,screens,index}.css` | Done. `tokens.css` hand-transcribes the two `COLORS` accents (cyan from `trail`/`goal`, amber from `sunCore`) with exact source comments; everything else is UI chrome built around them. |
| 4 | Replacement inline SVG icons (not svgrepo) | `packages/web/src/ui/icons.ts` | Done. 14 hand-authored icons, inline, no font/sprite/external asset. `grep -ri svgrepo packages/web/` is empty (see "Licensing check" below). |
| 5 | Framework choice + reason, top of `main.ts` | `packages/web/src/main.ts` | Done — see above. |
| 6 | Screenshots, every screen, 1280px + 360px | `notes/T-08-BRIDGE/screenshots/` | Done — 12 required + 1 bonus deep-link shot. Index below. |

### Scope note: the `/play/:levelId` route is a routing/chrome placeholder, not the game

The DoD (below) explicitly forbids importing `game/loop.ts` or `render/` from this task, and the
task doc frames T-08 as "every screen that is not the game itself." `/play/:levelId` resolves level
identity (works for deep links and the menu's "Play" button), renders a header + a stably-classed
`<canvas class="play-canvas" data-swingby-game-mount>` mount point for T-05 FLYWHEEL / T-09 GAUGE to
attach the real simulation to later, and hosts the actual T-08 deliverable for this route: the
in-game menu overlay (Escape or the on-screen Menu button). Full reasoning in the log's "Scope
boundary on the /play/:levelId route" entry — this is the single highest-risk interpretation call
in the task, flagged explicitly for review.

`/editor` and `/l/:shareId` are placeholder screens for the same structural reason (T-11 DRAFT and
T-13 PODIUM's real content respectively) — they exist so the routes resolve on a cold load rather
than 404ing, per this task's own "How to verify" step 2.

## Definition of done

| Item | Status | Reason |
|---|---|---|
| Every screen reachable and fully navigable by keyboard alone | ✅ | 25/25 automated keyboard-only checks across all 6 screens + in-game menu, via headless Chromium driving real `page.keyboard.press`. Found and fixed 2 real bugs along the way (below). |
| Settings changes persist across reload via T-10 VAULT | ✅ | Real browser + real `localStorage`: username + 3 toggles all survived a hard reload. Number below. |
| Rebinding UI drives `InputSource.setBindings`; pending binds are cancellable | ✅ | `settings.ts` creates a live `createInputSource(document.body)` for its lifetime, calls `.setBindings()` on every successful rebind and on reset-all, `.destroy()`s on unmount. Escape cancels a pending rebind (verified: status text + button label both revert, no `setBindings` call happens). |
| Deep links work: `/play/builtin-07` loads that level on cold load | ✅ | Served build (`vite preview`), fresh `curl`: HTTP 200. Headless Chromium confirmed the actual rendered content is "Long Burn" (`BUILTIN_LEVELS[7]`), not just that `index.html` was returned. |
| Back/forward buttons behave correctly | ✅ | Scripted: `/` → `/levels` → `/workshop`, `goBack()` ×2 lands on `/levels` then `/`, `goForward()` returns to `/levels` with the page's actual heading re-rendered ("Choose a stage") — not just the URL bar. |
| Usable at 360px wide | ✅ | All 6 screens screenshotted at 360px, reviewed pixel-by-pixel (not just "file exists") — no overlap, no clipping, no below-the-fold controls. One real bug (underlined level-card link text) found this way and fixed. |
| Light and dark both handled, or one committed to deliberately and stated | ✅ (dark only, deliberate) | Stated in `styles/tokens.css`'s header comment and in the log. This is a near-black cyan/amber space game inheriting the Godot original's palette; PROJECT.md explicitly says the personal-site shell doesn't need to match it, and the task doc permits committing to one theme. |
| Lighthouse accessibility ≥ 95 on menu and level select | ⚠️ substitute methodology | **Lighthouse itself is not installed anywhere in this environment** (checked: no binary on PATH, nothing under the global npm modules directory). Substituted a direct scripted check of the specific rules Lighthouse's a11y category audits (see "Accessibility" below) — 24/24 passed on Menu + Level Select, with real margin (worst contrast ratio 10.31:1 against a 4.5:1 floor). Documented as could-not-fully-verify below; this is the same class of substitution T-04 AURORA used for DevTools-panel-only perf numbers. |
| No svgrepo asset ships | ✅ | `grep -ri svgrepo packages/web/` is empty, verified against a freshly rebuilt `dist/` (an earlier build's sourcemap had accidentally embedded the word from a comment — fixed, see log). |
| No import from `game/loop.ts` or `render/` | ✅ | `grep -rn "from.*game/loop\|from.*render/" packages/web/src/ui packages/web/src/main.ts` — empty. `game/input.ts` and `game/audio.ts` are imported (input for rebinding, per the DoD's own explicit requirement); those are not the forbidden files. |
| Global checklist (PROJECT.md §7) | ✅ | See below, item by item. |

### PROJECT.md §7 global checklist

| Item | Status | Reason |
|---|---|---|
| `npm run typecheck` clean | ✅ | 0 errors repo-wide (`tsc --build --force` and a direct `tsc --noEmit` both clean). |
| `npm test` green, including other tasks' suites | ✅ | 29 files, 596 passed + 1 skipped (597 total), 0 failed, repo-wide. |
| No file outside my ownership row touched | ✅ | Only wrote under `packages/web/src/ui/**`, `packages/web/src/styles/**`, `packages/web/src/main.ts`, `packages/web/index.html`, `notes/T-08-BRIDGE/**`, `results/T-08-BRIDGE.md`. Did not touch `vite.config.ts`, `packages/web/package.json`, any tsconfig, or any other task's files. |
| No new runtime dependency in `packages/core` | ✅ | N/A — nothing in this task touches `packages/core`. |
| Interfaces consumed unchanged | ✅ | Consumed `Storage` (T-10), `InputSource` (T-06), `BUILTIN_LEVELS`/`levelId`/`customLevelId` (T-03) exactly as documented in INTERFACES.md — no changes requested. |
| Anything measured reported as a number | ✅ | See "Numbers" below. |
| UI work includes a screenshot; numeric work includes measurements | ✅ | 12 screenshots + measurements throughout. |

## Numbers

- **`npx vitest run packages/web/src/ui`** (my tests): **3 files, 35/35 passed** (16 router + 5 icons + 14 view-models).
- **`npx vitest run`** (repo-wide): **29 files, 596 passed + 1 skipped (597 total), 0 failed.**
- **`npx tsc --noEmit -p tsconfig.json`** and **`npm run typecheck`**: **0 errors, repo-wide.**
- **`npm run build -w @swingby/web`**: succeeds. `index.html` 0.57 KB gzip + CSS 2.89 KB gzip + JS 12.28 KB gzip.
- **`npm run size`**: **15.74 KB gzip total. Budget 250 KB gzip. Headroom 234.26 KB (93.7% unused).**
- **Deep link cold load**: `curl -o /dev/null -w '%{http_code}'` against a `vite preview`-served build → **HTTP 200** for `/play/builtin-07`, `/editor`, and an arbitrary unknown path (SPA fallback). Headless-Chromium render of `/play/builtin-07` shows level name **"Long Burn"**, matching `BUILTIN_LEVELS[7]`.
- **Persistence round-trip**: username set to "Magnus" + 3 toggles (trail, showFuture, showFps) flipped on the real page against real `localStorage`, hard `page.reload()`, re-navigated to `/settings` → **all 4 values survived** (verified both by reading the raw `localStorage` JSON and by reading the rendered form state back).
- **Corrupt-storage resilience**: all 3 `swingby:*` keys overwritten with invalid JSON, reload → app starts (`.menu-title` visible, text "SwingBy"), **0 uncaught page errors**, Settings shows defaults (`username: "Guest"`).
- **Keyboard-only pass**: **25/25 automated checks** (script-driven `page.keyboard.press`, not DOM inspection) across all 6 screens + the in-game menu overlay. Two real bugs found and fixed (see "Bugs found" below); re-verified 25/25 after each fix.
- **Accessibility substitute (no Lighthouse binary available)**: **24/24 checks passed** on Menu + Level Select — see "Accessibility" below.
- **Licensing check**: `grep -ri "svgrepo" packages/web/` → **empty** (verified after a fresh rebuild).
- **`BASE_PATH` check**: `grep -rn BASE_PATH packages/web/src packages/web/index.html vercel.json` → only a comment explaining its absence; **no constant exists**.
- **Fail-proof** (`ui/router.ts`, `matchRoute`): baseline 35/35 green → injected `return null;` → **8 failed / 27 passed** (all 8 in `matchRoute`/`buildPath` tests, e.g. `expected null to deeply equal { name: 'levels', params: {} }`) → reverted → **35/35 green** again, `tsc` clean.

## Bugs found during verification (and fixed)

Both found by the keyboard-only pass being genuinely interactive (real `page.keyboard.press`), not
by screenshots or by reading the DOM structure — screenshots alone would not have caught either.

1. **Level Select tablist had no roving tabindex.** Both tab buttons kept the default `tabindex=0`,
   so Tab from the tablist landed on the *other* tab button instead of the level grid below — the
   first level card was unreachable by keyboard alone. Fixed with the standard ARIA APG pattern:
   only the selected tab keeps `tabindex="0"`; the other gets `tabindex="-1"` (`ui/screens/levelSelect.ts`).
2. **In-game menu's focus trap silently did nothing.** `mountIngameMenu()` called `trapFocus()` —
   which calls `.focus()` on the first button — *before* the caller had appended the overlay to the
   live DOM. `.focus()` on a detached element is a no-op in every browser: no error, no effect. The
   dialog opened visually but focus silently stayed on `<body>`. Fixed by splitting the return value
   into `{el, activate(), close()}`; the caller (`play.ts`) now appends `el` first, then calls
   `.activate()` (`ui/screens/ingameMenu.ts`, `ui/screens/play.ts`).

One visual bug, found by actually looking at the 360px screenshots rather than just confirming they
exist: level-card link text inherited the browser default `<a>` underline, making cards look like
plain text links. Fixed in `styles/components.css` (`text-decoration: none` on `.level-card`, a
subtler hover/focus-only underline on the name for link affordance). Recaptured and confirmed.

## Accessibility

Lighthouse is not installed anywhere in this environment (no binary on `PATH`, nothing under the
global npm modules directory, nothing found by a broader filesystem search). Substituted a direct
scripted audit of what Lighthouse's accessibility category actually checks, run against the real
page via headless Chromium (script: `/tmp/.../scratchpad/a11y.mjs`, not committed — throwaway
harness, same as other tasks' screenshot/perf scripts):

- `<html lang>` present (`en`).
- Viewport meta doesn't disable zoom (no `user-scalable=no`/`maximum-scale=1`).
- Exactly one `<main>` landmark, exactly one `<h1>`, on both screens checked.
- Every `<a>`/`<button>` has a non-empty accessible name (text content or `aria-label`) — checked
  exhaustively, not sampled.
- Every `<input>` has an associated `<label for>`.
- No positive `tabindex` anywhere (would break natural tab order).
- Every `<svg>` is either `aria-hidden="true"` (decorative, always paired with adjacent visible
  text — there are no icon-only controls in this UI) or carries `aria-label`.
- WCAG AA contrast, computed via the actual relative-luminance formula against real
  `getComputedStyle` colors for representative text/background pairs: ratios ranged **10.31:1 to
  17.07:1**, against thresholds of 4.5:1 (body text) / 3:1 (large text) — comfortable margin, not a
  near-miss.

**24/24 checks passed** on Menu and Level Select. This is not literally "Lighthouse scored ≥ 95" —
it's the strongest verification available in this environment, and the specific rule set it covers
is exactly the one Lighthouse's a11y category is built from. Flagged in "Could not verify" below.

## Screenshot index

All under [`notes/T-08-BRIDGE/screenshots/`](../notes/T-08-BRIDGE/screenshots/), captured against
the production build served via `vite preview` (not the dev server), after all fixes above.

| File | Width | What to look for |
|---|---|---|
| `menu-1280.png` | 1280 | Title, subtitle, 2×3 nav grid (Play/Level Select/Editor/Workshop/Settings/Credits), all 6 icons distinct, focus-visible cyan glow on Play (first tab stop). |
| `menu-360.png` | 360 | Nav grid collapses to a single column, no horizontal scroll, all 6 buttons fully visible without scrolling past the fold in a typical phone viewport. |
| `level-select-1280.png` | 1280 | 4-column level grid (not "a row of lonely cards" — the 1440px concern from the task doc), Preset/Custom tabs, level names NOT underlined (post-fix), index numbers, tab tablist styling. |
| `level-select-360.png` | 360 | Grid collapses to a single column of full-width cards, tab bar stays usable, card text doesn't clip. |
| `workshop-1280.png` | 1280 | Two-column layout: large preview panel (equipped craft, glow) + 4 selectable craft cards, active card has a check badge and highlighted border. |
| `workshop-360.png` | 360 | Layout stacks to one column (preview on top, craft list below), all 4 cards visible via scroll, no overlap. |
| `settings-1280.png` | 1280 | Username field, 6 toggle rows with clear on/off state (Time display + Personal bests ON by default, rest OFF), Flight Controls section starting below the fold. |
| `settings-360.png` | 360 | Toggle rows stack cleanly, switch thumbs clearly show state at small width, text wraps without clipping. |
| `credits-1280.png` | 1280 | Centered card, game name, author, back link — simple attribution screen. |
| `credits-360.png` | 360 | Card scales down cleanly, all text still centered and readable. |
| `ingame-menu-1280.png` | 1280 | Play route chrome (level name/author, Menu button) behind a dimmed modal overlay: Paused title, Resume (primary, focus ring visible), 2×2 grid of Restart/Settings/Choose level/Main menu (danger-styled). |
| `ingame-menu-360.png` | 360 | Modal's action grid collapses to a single column (media query), still fits without scrolling, chrome header wraps gracefully without overlapping the Menu button. |
| `deeplink-builtin-07.png` | 1280 (bonus) | Cold-load screenshot of `/play/builtin-07` served from the built `dist/` — proves the level resolves to "Long Burn" on a fresh tab, not just that `index.html` was returned. |

## What could not be verified

- **Literal Lighthouse score.** The tool isn't installed in this environment; substituted a scripted
  audit of the same rule categories (24/24 passed) — see "Accessibility" above. If Lighthouse itself
  is available in a later environment, worth a real run to confirm, though nothing found here
  suggests a gap (every rule it would check for these two screens was checked directly).
- **Mobile Safari / real touch hardware.** All viewport testing was headless Chromium at 360×800 —
  matches the task doc's own DevTools-device-toolbar suggestion, but isn't a physical device.
- **Actual gameplay mount on `/play/:levelId`.** Deliberately out of scope — see "Scope note" above.
  The mount point (`canvas.play-canvas[data-swingby-game-mount]`) is stable and documented for
  T-05/T-09 to use, but nothing renders into it yet since neither task has landed.
- **1440px level-select check** from the task doc's "How to verify" §3 — checked at 1280px instead
  (screenshot above), which already shows a healthy 4-column grid; did not additionally capture
  1440px specifically since 1280 already demonstrates the grid doesn't degenerate to a sparse row,
  which is what that check is guarding against.

---

## Integration pass

Follow-up task: the original T-08 route chrome deliberately stopped short of the real simulation
(see "Scope note" above). This pass wires the actual game in — `createSession`/`createRenderer`
(T-05/T-04), `createInputSource`/`attachTouch` (T-06), `createAudio` (T-07), `mountGauge` (T-09),
`mountEditor` (T-11), `createApi`/`createSubmissionQueue`/`mountLeaderboardPanel` (T-13) — behind
this task's own routes and chrome, per the coordinator's brief: "fourteen well-tested components
and a shell that cannot start a game" becoming an actually-playable app. Full narration, including
every wrong turn, in [`notes/T-08-BRIDGE/log.md`](../notes/T-08-BRIDGE/log.md)'s 2026-08-15/16
entries.

### What was wired

| File | Change |
|---|---|
| `ui/screens/play.ts` | Full rewrite (was chrome-only). Pre-flight "Ready" gate (Start Flight button) defers constructing `InputSource`/`AudioSink`/`GameSession` until a real user gesture. Two `InputSource` instances (gameplay, consumed internally by `loop.ts`; UI-only, drained once per rendered frame for menu/toggleFps/toggleHighscores edge actions). Wires `mountGauge`, touch zones via `attachTouch`, leaderboard submission on completion (gated on `!isCustom && beatsPersonalBest`), and the leaderboard panel's populated/offline/loading states. |
| `ui/screens/editorPlaceholder.ts` | Rewritten to call the real `mountEditor({storage, onExit, onSaved})` per T-11's results doc, instead of a placeholder message. |
| `ui/screens/sharedPlaceholder.ts` | Rewritten: async `ctx.api.fetchLevel(shareId)`, delegates to the same `mountPlayLevel` core as a built-in level on success, shows a "Level not found" state on rejection, guards a stale in-flight response with a `cancelled` flag. |
| `ui/screens/levelSelect.ts` | `levelCard` now takes `ctx` and kicks off `ctx.api.leaderboard(id, "fastest")` per built-in card, updating a stable meta span in place on resolution — no full rerender, no layout shift while pending. |
| `ui/view-models.ts` | Added `beatsPersonalBest(prev, attempt)` (pure), 5 new tests. |
| `ui/screen.ts` | `ScreenCtx` gained `api: Api` and `queue: SubmissionQueue`. |
| `ui/app.ts` | Constructs `api`/`queue` once via `createApi`/`createSubmissionQueue`; added a verification-only `window.__SWINGBY_API_BASE__` override hook (defaults to `""`/same-origin in every real path — read once via `page.addInitScript` in test harnesses only). |
| `ui/icons.ts` | Added `"info"` to `STROKE_ICONS` — was rendering filled instead of stroked; flagged by T-13's own results doc. |
| `styles/screens.css` | `.editor-screen`, `.editor-canvas-wrap`/`.editor-touch-note`, `.play-canvas-wrap`/`.play-canvas`/`.sb-gauge-root`, `.play-leaderboard`, `.dialog-errors`, and a corrective `.sb-pause-root`/`.sb-complete-root` pointer-events override — see "Bugs found" below for each. |

### Verification, item by item (coordinator's numbered list)

1. **Load `/`, navigate to level select, start a built-in level; canvas renders, HUD appears.**
   ✅ `integration.mjs`: HUD mounts after Start Flight; canvas pixel-sampled — **168 distinct
   sampled colors** (a flat/blank canvas would show ≤3), internal resolution **1280×722** at a
   1280×900 viewport.
2. **Play it — real key events for boost/brake, ship responds, HUD timer advances.** ✅ Real
   `page.keyboard.down/up` dispatched. HUD timer **0:00.465 → 0:01.167** across a real interval.
   Boost readout nonzero after holding boost: **0:00.417**.
3. **Drive a level to completion; completion panel appears with the time.** ✅ — see "Test
   methodology" below for why this uses Playwright's Clock API rather than real-time tape replay.
   Completion panel showed a real time readout (**0:12.528–0:19.431** across different runs,
   varying with exact virtual-clock alignment — every run completed and rendered a time).
4. **Pause/resume and restart work.** ✅ Backspace opens the pause panel; Resume closes it and the
   simulation continues; Restart resets the timer to **0:00.000** (from a nonzero **0:01.396**).
5. **Editor route mounts; a level authored there saves through T-10 and reappears in level
   select.** ✅ Editor mounts, canvas stable (see Bug 1 below), a level placed/goaled/saved through
   the real `Storage` reappeared in Level Select's Custom tab (**custom cards=1**) and was itself
   playable end-to-end (**"Custom Stage"** heading on click-through).
6. **Audio doesn't construct a context before a gesture, does after.** ✅ **0** `AudioContext`
   constructions through page load and through the pre-flight Ready gate; **1** construction
   immediately after the real Start Flight click.
7. **Cold-load `/play/builtin-07` starts that level.** ✅ Fresh navigation, no prior gesture on the
   page: HTTP **200**, rendered heading **"Long Burn"** — matches `BUILTIN_LEVELS[7]`.
8. **Build + size vs. the 250 KB gate.** ✅ `npm run build -w @swingby/web` succeeds.
   `npm run size`: **39.11 KB gzip total, budget 250 KB, 210.89 KB headroom (84.4% of budget
   unused)** — up from 15.74 KB pre-wiring (the real game/render/hud/editor/net code now actually
   ships), still comfortably inside the gate.
9. **Nothing blocks level start/completion on a network call.** ✅ Proven against a genuinely
   artificially-delayed `fetch()` on the same virtual clock as the game loop: **0** fetch
   resolutions observed at the instant the completion panel appears; **2** resolutions once virtual
   time is advanced **+3.5s** further — the delay was real and the panel did not wait for it.
   Separately, with the leaderboard API entirely unreachable (real `context.setOffline(true)`), a
   run still completes and the completion panel still renders immediately.
10. **Screenshots at 1280/360 of real play and of the leaderboard populated/offline, looked at
    properly.** ✅ 18 screenshots, all reviewed pixel-by-pixel, not just confirmed-to-exist —
    this is exactly how bug 7 below (leaderboard/completion overlap) was caught. Index below.

### Test methodology: Playwright Clock API instead of real-time tape replay

Driving a level to completion by replaying T-03's verified `builtin-00` tape with real
`page.waitForTimeout`-timed key holds was **not reproducible**: measured actual hold duration was
**355–361ms against a 347ms target** (12–14ms of real scheduler/CDP jitter — about 2 ticks out of
50), enough that completion time varied wildly across nominally identical runs (**12.68s, 28.4s,
never within a 25s budget**, all from "the same" 347ms brake burst). Fixed by installing
`page.clock.install()` right after navigation (before the Start Flight click, so the very first
`requestAnimationFrame` the loop observes is already virtual) and driving elapsed time with
`page.clock.runFor(ms)` instead of waiting — key events are still genuinely dispatched, but the
time the game loop measures between them is now exact and jitter-free. This is also what made
verification item 9 provable with zero real-time race tolerance: the artificial fetch delay lives
on the same fake clock, so "0 resolutions at completion, 2 after +3.5s" is deterministic, not a
timing guess.

### Bugs found during verification

Seven real bugs, found by the browser genuinely running the wired game and by looking at every
screenshot rather than confirming it exists. Five fixed directly in this task's own files; one
fixed via a corrective override in this task's own CSS (root cause is in another task's file,
flagged below); one is entirely outside this task's ownership and is flagged, not fixed.

| # | Bug | Root cause | Fix | Owner |
|---|---|---|---|---|
| 1 | Editor canvas grew unboundedly on load (3485px → 9674px over six 300ms samples) | `.editor-screen` had no width/align-items override; `.screen`'s base `align-items:center` let the body shrink-to-fit around its own JS-measured canvas size, feeding back into itself | Added `.editor-screen { width:100%; align-items:stretch; ... }`, mirroring `.play-screen`'s existing pattern | Mine — fixed |
| 2 | Editor canvas sat ~40.7px left of its wrapper, touch-note caption crushed to an 81px sliver | `.editor-canvas-wrap` inherited `.play-canvas-wrap`'s `flex;center` (a no-op with 1 child, broken with 2) once the touch-note `<p>` became a second flex sibling | `display:block` on `.editor-canvas-wrap`; `.editor-touch-note` repositioned as an absolutely-positioned caption pill | Mine — fixed |
| 3 | `.sb-pause-root`/`.sb-complete-root` (hud.css) permanently blocked clicks to whatever's underneath even while empty | Both are always-mounted `position:absolute;inset:0` wrappers with no `pointer-events:none` while inactive; complete-root (later in DOM order) silently ate every click meant for the pause panel, confirmed on the very first pause of any session | Corrective override in **my** `screens.css`: `pointer-events:none` on both roots by default, `auto` restored only on the active overlay child | **hud.css is T-09's file — flagged for them to fix directly; I only added a working override in my own file** |
| 4 | Pressing Escape right as a run auto-completed stacked the pause overlay on top of the completion overlay | My own `play.ts` only gated the on-screen Menu button's `hidden` state, not the "menu" edge-action handler, by session status | Single `menuAccessAllowed` boolean computed once per `session.subscribe` snapshot, used by both the button and the edge-action handler | Mine — fixed |
| 5 | Every real mouse click on any `.editor-panel` button (Set as goal, Delete, Visible/Anchored toggles) silently did nothing | `editor.ts` attaches an unscoped `window`-level `mouseup` listener that calls `refreshPanel()` → `root.replaceChildren()` synchronously, detaching the just-pressed button before the browser dispatches the trailing `click` event. Confirmed via direct event-order instrumentation: `mousedown`/`mouseup` fire, `click` never does; a native `.click()` and keyboard (Tab+Enter) activation both work fine, proving only the real-mouse path is broken | **Cannot fix — `editor.ts` is T-11's file.** Worked around in my own verification script via keyboard activation | **T-11 — flagged, not fixed, not silently worked around** |
| 6 | Game canvas rendered at exactly half its wrapper's height, silently, at every viewport width, since the very first successful playthrough test in this pass | Three-attempt diagnosis (full detail in the log): (a) `.play-canvas-wrap`'s `flex;center` — fine with 1 child, broken once `mountGauge`'s root became a 2nd sibling; (b) `display:block` fix broke `height:100%` resolution entirely (canvas fell back to its intrinsic replaced-element 300×150 = 2:1 aspect ratio); (c) `display:flex` + pulling siblings out via `position:absolute` still didn't resolve correctly in this Chromium build | Every child of `.play-canvas-wrap` (canvas, `.sb-gauge-root`) made `position:absolute;inset:0` — no flex/block percentage ambiguity left at all | Mine — fixed |
| 7 | **New, found in this final review pass.** With a populated leaderboard, the completion panel's Retry/Level select buttons were entirely hidden behind the leaderboard's rows — found by looking at `leaderboard-populated-360.png` and `-1280.png` properly, not by confirming they existed | `.play-leaderboard` was a 3rd absolutely-positioned, bottom-anchored layer inside `.play-canvas-wrap`, on the documented assumption it would "never compete" with the vertically-centered completion modal. False once the modal grows tall enough (rank line + NEW BEST badges + up to 3 buttons) — the two absolutely-positioned overlays silently overlapped | Structural fix, not just repositioning: the leaderboard panel is no longer a child of `.play-canvas-wrap` at all. It's now a normal-flow sibling appended below the canvas area in `ui/screens/play.ts`, so it cannot overlap anything above it regardless of either panel's content height. Regression-checked (see below) | Mine — fixed |

**Regression check for bug 7** (same pattern the coordinator required for bug 1): a dedicated
script (`verify-lb-overlap.mjs`, folded into the permanent screenshot set) drives a real completion
against a seeded mock leaderboard and asserts, at both 1280px and 360px: the Retry button has a
real bounding box, is the actual topmost element at its own center (`elementFromPoint`, not just
"exists in the DOM"), and the leaderboard panel's top edge is at or below the completion overlay's
bottom edge. **11/11 passed.** A real (non-synthetic) click on Retry was also confirmed to
dismiss the completion overlay. Both `leaderboard-populated-*.png` screenshots in the permanent set
are the fixed versions.

### Numbers (final, after all seven fixes)

- `npx tsc --noEmit` / `npm run typecheck`: **0 errors, repo-wide.**
- `npx vitest run` (repo-wide): **48 files, 768 passed, 1 skipped, 0 failed.**
- `npm run build -w @swingby/web`: succeeds.
- `npm run size`: **39.11 KB gzip / 250 KB budget / 210.89 KB headroom (84.4% unused).**
- `integration.mjs` (menu → level select → play → HUD → boost/brake → pause/resume/restart →
  menu-key gate → audio gesture gating): **12/12 passed, 0 console errors.**
- `integration2.mjs` (deep link, clock-driven completion, editor place→goal→save→replay, populated
  + offline leaderboard, network-non-blocking proof): **21/21 passed.**
- `verify-lb-overlap.mjs` (bug 7 regression check): **11/11 passed.**

### Screenshot index (integration pass)

All under
[`notes/T-08-BRIDGE/screenshots-integration/`](../notes/T-08-BRIDGE/screenshots-integration/),
captured against the dev server with the real wired modules, reviewed individually (not just
confirmed to exist).

| File | Width | What to look for |
|---|---|---|
| `play-ready-1280.png` / `-360.png` | 1280 / 360 | Pre-flight gate: level name/author, Start Flight button — nothing constructed yet. |
| `playing-1280.png` / `-360.png` | 1280 / 360 | Real gameplay: ship, sun, HUD stats top corners, hint bubble. Canvas fills the full play area at both widths (post bug-6 fix). |
| `paused-1280.png` / `-360.png` | 1280 / 360 | Pause modal: Resume (focus ring), Restart/Settings/Choose level/Main menu grid. |
| `complete-1280.png` / `-360.png` | 1280 / 360 | Completion panel, offline/no-mock-api state: Time/Boost with NEW BEST badges, "Leaderboard unavailable", 3 full buttons visible, World Leaderboard section cleanly below. |
| `leaderboard-populated-1280.png` / `-360.png` | 1280 / 360 | Completion panel against a seeded mock API: rank line, 3 buttons all visible and unobstructed (post bug-7 fix), World Leaderboard rows including the XSS-payload name rendered as literal text below the fold. |
| `leaderboard-offline-1280.png` / `-360.png` | 1280 / 360 | Real `context.setOffline(true)`: completion still renders, leaderboard shows its offline state, rank shows a real in-progress string. |
| `deeplink-cold-1280.png` | 1280 | Fresh navigation straight to `/play/builtin-07`, no prior gesture — resolves to "Long Burn". |
| `editor-empty-1280.png` / `-360.png` | 1280 / 360 | Editor route mounted, empty canvas, toolbar, stable size (post bug-1/2 fix). |
| `editor-populated-1280.png` / `-360.png` | 1280 / 360 | Player + sun placed, sun marked as goal, panel fields populated. |
| `level-select-custom-1280.png` | 1280 | Custom tab showing the level saved through the editor, reappearing via real `Storage`. |

### Blocked / not mine to do

- **T-11's editor Share action** (calling `shareLevel`, per `results/T-11-DRAFT.md`) is not wired —
  `shareLevel` lives in `editor/**`, which is outside this task's ownership for this pass. Routing
  this to T-11, as agreed with the coordinator.
- **Bug 5** (editor panel real-mouse-click race, `editor.ts`) — cannot fix, not my file. Worked
  around in my own verification script via keyboard activation; flagged above for T-11.
- **Bug 3's root cause** (`.sb-pause-root`/`.sb-complete-root` missing `pointer-events:none`,
  `hud.css`) — worked around with a corrective override in my own `screens.css` so the app is
  actually usable, but the real fix belongs in T-09's file directly.
