# T-09 GAUGE — thought log

## 2026-08-15T11:00Z — plan, before any code

Read in order: README.md, PROJECT.md, INTERFACES.md, tasks/T-09-GAUGE.md, then
`reference/godot/scripts/HUDController.gd` (full, 309 lines), `GameConstants.gd` (full),
`UIBuilder.gd`'s `format_time`/`format_score_entry` (lines 2096-2103), `packages/core/src/types.ts`
(full, frozen), `packages/core/src/constants.ts` (full, frozen — `TPS`, `COLORS`), then the REAL,
already-landed T-05 `packages/web/src/game/loop.ts` (full — `GameSnapshot`/`GameSession`/
`CompletionPayload`, and the tick->ms formula), `notes/T-05-FLYWHEEL/log.md` (full) and
`notes/T-04-AURORA/log.md` (full, per the brief's explicit instruction). Also read the REAL,
already-landed `packages/web/src/game/touch-zones.ts`, `input.ts`, `storage/index.ts`,
`ui/screens/ingameMenu.ts`, `ui/screens/play.ts`, `main.ts`, `index.html` (read-only — none of these
are mine to edit) to find the actual integration surface, plus `reference/godot/scripts/GameWorld.gd`
lines 895-966 for the real tutorial-hint logic (task doc's own Hints section references
`reference/swift`'s `{condition, text}` model, which turned out not to exist in this checkout — see
finding below). Confirmed via `node -e` that this test environment has no jsdom and no DOM globals
(`typeof document === "undefined"`), matching T-04/T-05's independent findings — every DOM-touching
module here needs a hand-rolled fake DOM for tests, same precedent as their fake-canvas stubs.

### Key findings that shape the design

1. **`GameSnapshot` (frozen, `game/loop.ts`) is exactly `{status, elapsedTicks, boostTicks, fps,
   boundsWarning, reachedGoal}` — no level metadata, no player position, no distance-to-goal, no
   speed.** This matters a lot for the Hints section: Godot's real `_tutorial_hint()`
   (`GameWorld.gd:937-965`) branches on distance-to-goal and player speed, neither of which is in the
   frozen snapshot and neither of which I can add (I don't own `game/loop.ts`, and it's someone else's
   landed, frozen deliverable). **Decision:** build a hint evaluator over exactly the fields
   `GameSnapshot` actually offers (`status`, `elapsedTicks`, `boostTicks`, `boundsWarning`,
   `reachedGoal`), with conditions `nearBounds` (`boundsWarning > 0.3`, the literal threshold Godot
   uses at `GameWorld.gd:944`), `notBoosted` (`boostTicks === 0` after a short grace period so it
   doesn't flash at tick 0), `nearGoal` (**reserved, always false today** — no goal-distance field
   exists in the frozen snapshot to drive it; the evaluator supports the condition structurally so a
   future snapshot extension needs no schema churn on my side, exactly what the task doc asks for),
   and `default` (a static per-level fallback string). Flagged as an open question below.
2. **Task doc's claim "The Swift project models these as `{condition, text}`" does not match what's
   actually in `reference/swift/`** — that directory has exactly 3 files (`InputManager.swift`,
   `EditorScene.swift`, `AudioManager.swift`), none of which contain any hint/condition/text model
   (`grep -rn "notBoosted\|nearBounds\|nearGoal\|[Hh]int"` returns nothing). Not investigating
   further — reference/ is read-only and this is a documentation-vs-checkout mismatch, not something
   for me to resolve. Using the task doc's own condition names (`notBoosted`, `nearBounds`,
   `nearGoal`) as the contract since those are explicit in the brief, and porting the *real* Godot
   tutorial hint text (`GameWorld.gd:907-965`, `_level_label`/`_hint_for_level`/`_tutorial_hint`) as
   the actual copy, since README says "All behaviour comes from here [reference/godot/]".
3. **T-08 BRIDGE has already built and wired the full in-game pause MENU** (`ui/screens/ingameMenu.ts`
   → `mountIngameMenu`, used by `ui/screens/play.ts`'s `openMenu`/`closeMenu`), and its own header
   comment says explicitly: "Kept separate so T-09 GAUGE can reuse it once a real GameSession exists."
   Task doc: "Pause ... Reuses T-08's in-game menu component; coordinate rather than duplicating it."
   **Decision: `pause.ts` imports `mountIngameMenu`/`IngameMenuCallbacks`/`IngameMenuHandle` from
   `../ui/screens/ingameMenu.js` (read-only import, not an edit) and wraps it with session-awareness**
   (auto show/hide keyed off `snapshot.status === "paused"`, `onResume`→`session.resume()`,
   `onRestart`→`session.restart()`), forwarding `onSettings`/`onChooseLevel`/`onMainMenu` untouched
   to the caller (routing is T-08's concern, out of my scope, same boundary `play.ts` already draws).
   **Risk, explicitly flagged:** `ui/screens/ingameMenu.ts` is being edited concurrently by another
   agent right now. If its exported shape changes after I write against it, my typecheck could break
   through no fault of my own — same category of transient cross-task breakage T-05's log records for
   `api/test/`. I will re-run `npm run typecheck` right before finishing and note the outcome.
4. **`main.ts`/`index.html`/`ui/screens/play.ts` do NOT currently mount any game/HUD at all** —
   `play.ts`'s canvas is explicitly a placeholder (`data-swingby-game-mount`, comment: "Flight systems
   mount here once a session starts — T-05 FLYWHEEL / T-09 GAUGE") and `main.ts` never imports
   anything from `hud/` or `game/loop.ts`. Since those three files are T-08's and off-limits to me,
   **I cannot wire the HUD into the live routed app inside this task** — that is a future integration
   step (T-08 continuing, or a dedicated wiring task). My job is to ship self-contained, well-typed
   `hud/` modules that make that wiring trivial later, and to prove they work via my OWN dev harness
   (`hud/hud-dev.html`, same non-index-entry pattern T-04 used for `render/dev.html` — Vite's dev
   server serves any path, no `vite.config.ts` edit needed) and my own tests. This is not a shortfall
   in scope, it's the same "code against interfaces, the wiring lands later" model every task here
   uses — flagging it explicitly so it isn't mistaken for an oversight in the results file.
5. **No stylesheet ownership path exists for me.** `styles/**` is T-08's. Since nothing wires my CSS
   into `index.html`/`main.ts` yet anyway (see #4), I'm shipping a self-contained
   `packages/web/src/hud/hud.css` (inside my own owned tree) that doesn't `@import` or depend on
   T-08's `tokens.css` custom properties at all — it defines its own scoped tokens under a `.sb-hud`
   root class, deriving the two accent colors it needs from `COLORS` in `constants.ts` (via a small
   runtime helper `rgba(tuple, alpha?)`, not hand-transcribed hex, so "use it, don't redefine it" is
   satisfied structurally, not just by eyeballing a match) and using plain sensible neutrals for
   panel chrome (`COLORS` has no chrome colors — same conclusion T-08's own `tokens.css` comment
   reached independently). My dev harness `<link>`s it directly; a future integration step links it
   from `index.html` or imports it from `main.ts` alongside `styles/index.css`.
6. **T-06 HELM's `attachTouch` takes caller-supplied `DOMRect`s with NO default geometry anywhere in
   the codebase** — confirmed no call site exists yet (`play.ts`'s canvas never calls `attachTouch`).
   So there is no live "real" zone geometry to check my HUD layout against. **Assumption, flagged:**
   I'm adopting the standard twin-thumb-zone convention (bottom-left, bottom-right quadrants) purely
   to self-check my own layout, documented inline in `hud.css` and demonstrated in a screenshot with
   the assumed zones overlaid. Since HUD's only always-on elements sit in the top band (level label,
   timers, hint) and the interactive panels (pause/complete) are full-screen modals that legitimately
   cover the zones while the sim is paused/finished anyway, the actual overlap risk is low regardless
   of exactly where T-06's real caller ends up drawing the rects.
7. **`loop.ts`'s own `frame()` drains `input.drainEvents()` every frame and explicitly discards
   `menu`/`toggleFps`/`toggleHighscores`** (comment at `loop.ts` "Other edge-triggered actions ...
   are UI/settings concerns outside a GameSession's scope"). Since `InputSource.drainEvents()` empties
   the queue and only `loop.ts` ever calls it (it owns `opts.input`), **there is no way for `hud.ts`
   to observe an F1/H keypress through the frozen `GameSession` interface — those events are consumed
   and thrown away before anything else can see them.** This is a real architectural gap between
   T-05/T-06/T-09's interfaces, not something introduced by me, and I cannot fix it without editing
   `game/loop.ts` (not mine). **Decision:** `hud.ts` does not attempt to react to those hotkeys at
   all; `showFps`/`showTimes`/`showHighscores` visibility is driven purely by polling
   `storage.getSettings()` (throttled, see perf section below), which is how the Settings screen
   (already built by T-08) actually changes them. Documented as an open gap for the results file, not
   silently worked around.
8. **Tick->ms: `Math.round(ticks * 1000 / TPS)`**, identical to `replay.ts`'s private `ticksToMs` and
   `loop.ts`'s own `ticksToMs` (both already cross-verified against each other in T-05's log via a
   real `verifyReplay` accept). I will define this ONCE in `hud/format.ts` and use it everywhere I
   need a *live* (pre-completion) time readout. For the completion panel, I will **never recompute**
   `timeMs`/`boostMs` from ticks myself — I display exactly the `timeMs`/`boostMs` fields handed to me
   by `session.onComplete`'s payload, which `loop.ts` already computed with the identical formula.
   This is the only way to make "no rounding drift between the live HUD and the recorded score"
   (DoD) actually airtight rather than "probably the same formula".

### Architecture decided (file list, beyond the 4 named deliverables)

- `packages/web/src/hud/format.ts` — `ticksToMs`, `formatDuration` (`M:SS.mmm`), shared by hud.ts
  and complete.ts. Single source of truth for #8 above.
- `packages/web/src/hud/hints.ts` — `HintRule`/`HintCondition`/`evaluateHint`/`hintRulesForLevel`,
  per finding #1/#2. Ships real ported Godot hint text for every named builtin level
  (`GameWorld.gd:922-934`) plus the dynamic bounds/not-boosted overrides.
- `packages/web/src/hud/toast.ts` — deliverable 4. Genuine FIFO queue (deliberate divergence from
  Godot's own `show_toast`, which just *interrupts* the current toast with the latest one — the task
  doc's deliverable is explicitly titled "Toast queue" and its DoD tests queueing/draining, so this
  is a directed enhancement, not a port, and I'm recording the divergence here so it doesn't read as
  a missed detail). One reused DOM node (never more than one toast mounted at a time — "does not
  stack into a wall" from the DoD, literally).
- `packages/web/src/hud/hud.ts` — deliverable 1.
- `packages/web/src/hud/pause.ts` — deliverable 2, wraps T-08's `mountIngameMenu` per finding #3.
- `packages/web/src/hud/complete.ts` — deliverable 3, owns the one `storage.recordBest()` call per
  attempt (so it naturally fires exactly once, matching "completion panel appears exactly once");
  typed placeholder slot for T-13's rank (`setRank({status, rank?})`), defaults to `"unavailable"`,
  never blocks initial render on anything async (hard rule 6 / INTERFACES.md's net.ts contract).
- `packages/web/src/hud/index.ts` — barrel + a `mountGauge()` convenience that wires hud+pause+
  toast+complete together against one `GameSession`, for the dev harness and for whoever does the
  real `main.ts` integration later.
- `packages/web/src/hud/hud.css` — per finding #5.
- `packages/web/src/hud/__tests__/fakeDom.ts` — hand-rolled fake `document`/element stub (classList,
  style, textContent, append/remove, addEventListener), same precedent as T-04's `FakeContext` /
  T-05's `FakeCtx` ("duplicating a ~20-line stub is cheaper than coupling to another task's test
  infra"). Lives inside my own owned `hud/**`, imported by my `packages/web/test/hud*.test.ts` files
  (which must live in the shared `test/` dir per my explicit ownership list) via a relative path —
  keeps the actual *.test.ts files where they're required to be, without inventing an ownership-
  ambiguous shared helper file directly in `packages/web/test/`.
- `packages/web/src/hud/hud-dev.ts` / `hud/hud-dev.html` — standalone harness (not part of the main
  app entry, same non-wired pattern as `render/dev.html`), builds a real canvas + real `createSession`
  against a builtin level, used for screenshots and manual verification.
- `packages/web/test/fake-session.ts` — deliverable 5.
- `packages/web/test/hud.test.ts`, `hud-toast.test.ts`, `hud-pause.test.ts`, `hud-complete.test.ts`,
  `hud-hints.test.ts`, `hud-format.test.ts`, `hud-e2e.test.ts` — my tests, all matching `hud*.test.ts`.

### Perf design decided up front (hard rule 4 / task doc's "Update discipline")

- Cache every DOM node reference once at mount; the `subscribe` callback never queries the DOM.
- Split the callback into an "every frame, cheap" tier (pause indicator visibility, bounds-warning
  glow opacity — both single `classList`/style writes, both compare-before-write so a steady value
  costs zero DOM writes) and a "throttled ~10Hz" tier (time/boost/FPS text, personal-best text,
  settings poll, hint re-evaluation) using a plain modulo counter on the subscribe call count — NOT
  `performance.now()` — so the throttle is deterministic and needs no clock mocking in tests (T-04's
  log flagged `performance.now()`-based cosmetic state as a real flakiness hazard in exact-comparison
  tests; sidestepping that class of bug entirely here since I have no reason to need wall-clock time).
- No `offsetWidth`/`getBoundingClientRect` anywhere in the subscribe callback.
- No new DOM nodes created in the subscribe callback — only `textContent`/`style`/`classList` writes
  on nodes cached at mount. Toasts (rare, not per-frame) are the one place new nodes get created, and
  even there it's one reused node, not one per toast.
- Measurement plan: drive N snapshots through the fake session in a tight loop (deliverable 5),
  time the subscribe callback with `performance.now()` around the loop (test-time measurement only,
  not inside the shipped code), report µs/update, and count DOM writes via the fake DOM's own call
  log (same technique as T-04's `FakeContext.calls`).

### Not yet done

No code written yet. Next: `packages/web/test/fake-session.ts` (deliverable 5, built first per hard
rule 5 — everything else's tests depend on it), then `hud/__tests__/fakeDom.ts`, then `format.ts`
and `hints.ts` (pure, no DOM, quick to get green), then `toast.ts`, then `hud.ts`, then `pause.ts`,
then `complete.ts`, then `hud/index.ts`, then `hud.css`, then the dev harness, then the real-session
e2e test, then measurements, then screenshots, then the break/restore proof, then
`results/T-09-GAUGE.md`. Will log again after fake-session.ts + fakeDom.ts land (the foundation
everything else builds on), and again before anything slow/risky (headless Chromium, the real-session
e2e drive, the break/restore proof).

## 2026-08-15T11:45Z — all 9 source/support files written, first typecheck clean

Wrote, in order: `packages/web/test/fake-session.ts` (deliverable 5 — `createFakeSession` with
realistic start/pause/resume/restart/destroy plus manual `push`/`patch`/`fireComplete`, and the
named scripted-scenario helpers the brief calls out: `driveBoundsWarningRamp`, `driveResetFlash`,
`drivePaused`, `driveCompletion`), `hud/__tests__/fakeDom.ts` (hand-rolled fake DOM, `style` writes
counted via a `Proxy` so nothing needs pre-declaring, `classList`/`textContent`/`setAttribute` all
counted too — the deliverable-6 instrument), `hud/format.ts`, `hud/colors.ts`, `hud/hints.ts`,
`hud/toast.ts`, `hud/hud.ts`, `hud/pause.ts`, `hud/complete.ts`, `hud/index.ts`, `hud/hud.css`.

Design decisions made while writing, not already in the plan entry:
- `pause.ts`'s Resume/Restart buttons call BOTH `session.resume()`/`restart()` AND an explicit
  `hideOverlay()` in the same synchronous handler, rather than relying only on the status-driven
  `subscribe` watcher to close the panel. Reason found while writing: the REAL `loop.ts`'s
  `resume()`/`restart()` only flip an internal `status` variable — they do NOT call
  `renderAndNotify()` themselves, so a real session's subscribers only learn about the change on the
  NEXT rendered frame (up to ~16ms later), which would be a visible one-frame flicker before the
  panel closes. My `FakeSession`, by contrast, notifies synchronously inside `patch()`. Both are
  legitimate, but only the explicit-hide-in-the-handler design gives correct (no-flicker) behavior
  against the REAL session; the status watcher stays as a safety net for other status changes not
  triggered by these two buttons (e.g. an external caller, or the bound restart key firing while the
  panel happens to be open).
- `complete.ts` reads `storage.getBest()` BEFORE calling `storage.recordBest()` in the same
  `onComplete` callback, specifically so "previous best" and "is this a new best" both describe the
  pre-attempt state — recordBest mutates the stored value, so the order matters and doing it any
  other way would show the JUST-RECORDED value as its own "previous" best.
- `hud/index.ts`'s `mountGauge` subscribes to the session AFTER `mountHud`/`mountPausePanel` have
  already subscribed, specifically so its own coordinating callback (suppressing the small pause
  badge while the full panel is open) observes their already-updated state within the same
  notification pass — subscriber order is registration order in both the real and fake session
  (confirmed by reading `loop.ts`'s `subscribers.slice()` dispatch and my own `fake-session.ts`,
  which mirrors it deliberately).

`npm run typecheck` (repo-wide `tsc --build --force`): **clean, exit 0, zero errors**, on the FIRST
run after writing all 9 files — no back-and-forth needed. Re-ran a second time to rule out a
transient miss: still 0. This also confirms the `ui/screens/ingameMenu.ts` import in `pause.ts`
(the risk flagged in finding #3) is currently compatible with what T-08 has landed as of this
moment — will re-check right before finishing per that finding's stated plan, since T-08 is still
being edited concurrently.

### Next step

Write the test files (`hud-format.test.ts`, `hud-hints.test.ts`, `hud-toast.test.ts`, `hud.test.ts`,
`hud-pause.test.ts`, `hud-complete.test.ts`), run them, fix anything red, then the dev harness +
real-session e2e test (the slow/risky step — will log again immediately before headless Chromium).

## 2026-08-15T12:20Z — 6 unit test files green (45/45), 2 real bugs found+fixed, about to run the real-session e2e test

Wrote and ran, in order, fixing as I went (not all green on the first try — recording the real
findings, not glossing over them):

- `hud-format.test.ts` (4), `hud-hints.test.ts` (7) — pure logic, green on the first run.
- `hud-toast.test.ts` (7) — **real bug found**: `toast.destroy()` didn't reset the internal
  `visible` flag, so `currentMessage()` kept returning the last-shown text after destroy instead of
  `null`. Fixed by setting `visible = false` in `destroy()`. Re-ran: green.
- `hud.test.ts` (10, including deliverable 6's measurement) — needed `fakeDom.ts`'s `style` to
  support `setProperty`/`getPropertyValue`/`removeProperty` methods (not just plain property
  assignment) once I actually ran `hud.ts` against it — `root.style.setProperty(...)` (used for the
  `--sb-hud-glow-color` custom property, which isn't a valid JS identifier so can't go through plain
  assignment) threw `setProperty is not a function` against my first Proxy-only version. Fixed by
  handing back bound methods from the Proxy's `get` trap. Also found a test-construction mistake of
  my own (not a source bug): my "steady state costs zero DOM writes" test froze an arbitrary
  snapshot mid-throttle-cycle and expected zero writes immediately — but the throttled tier is up to
  14 calls stale, so the FIRST throttled tick after freezing legitimately has one catch-up write
  (bringing the stale cached text in line with the frozen value) before it's truly steady. Fixed the
  test to drive one full throttle cycle before resetting the write counter, isolating genuine
  steady-state cost. **Measured: 10,000 updates in ~11-22ms (~1.0-2.2 us/update across repeated
  runs — noisy at this scale, all comfortably under budget), 1.163 DOM writes/update average, 0
  writes for 1000 repeats of an already-stable snapshot.** Exact numbers going in results.md are
  from the final clean run.
- `hud-pause.test.ts` — **this is where the T-08 coupling risk flagged in finding #3 became real,
  though not from a shape CHANGE — from my fake DOM simply not being complete enough for what
  `mountIngameMenu` pulls in transitively.** `ui/dom.ts`'s `fromMarkup()` (used for inlining icon
  SVGs) calls `wrap.innerHTML = markup; wrap.firstElementChild`, and `trapFocus()` calls
  `container.querySelectorAll(...)` and reads `document.activeElement`/`el.offsetParent` — none of
  which my original fakeDom.ts implemented. Extended `fakeDom.ts` (still fully inside my own owned
  `hud/**`, not touching `ui/dom.ts` itself) with: a minimal single-root-tag `innerHTML` parser (only
  needs to produce A root element, icon internals are never inspected by my tests),
  `firstElementChild`, a small selector-subset `querySelectorAll` (tag name + `[attr]`/
  `[attr="val"]` + `:not([...])` — exactly what `trapFocus`'s one hard-coded selector string uses,
  not a general CSS engine), `className` (routed through `classList.replaceAll`, since `h()` sets
  `el.className = "..."` rather than calling `classList.add`), and `document.activeElement` tracking
  via a shared mutable `DocState` threaded through every `FakeElement`. Also found and fixed a
  second real bug while wiring this up: my original `textContent` getter returned a private field
  that was only ever set by DIRECT assignment, so text built via `.append(string)` (exactly how
  `mountIngameMenu`'s buttons build their "icon + label" content) was invisible to
  `el.textContent.includes(...)` — real `textContent` is a COMPUTED getter over descendant text
  nodes, not a stored field, and my fake needed to actually work that way. Fixed by making the
  getter recursively concatenate children's text (with a real leaf `#TEXT` node type holding the
  actual string) instead of tracking one flat field. After both fixes: **7/7 green**, and critically,
  this exercises the REAL, currently-landed `mountIngameMenu` — not a mock of it — so if T-08's
  concurrent edits change its shape before I finish, this test (not just typecheck) would catch it.
- `hud-complete.test.ts` (10) — green on the first run once the `textContent` fix above was in place
  (complete.ts's own buttons don't mix icon+text like ingameMenu's do, but the fix helps generally).
  Covers: hidden-until-complete, first-ever completion (both new best), a worse repeat (neither new,
  real previous-best text shown), a mixed result (exactly one badge), the "displays exactly the
  payload's timeMs/boostMs, ignores tape.ticks" readout-agreement check, the rank slot's
  unavailable/loading/loaded transitions, Retry -> `session.restart()` + auto-hide, hiding on an
  EXTERNAL restart (not just its own Retry button), omitting Next when absent, and 10 completions in
  a row opening exactly 10 times.

Full run: `npx vitest run packages/web/test/hud*` (using the shared glob across all 6 files) —
**45/45 passed**. `npm run typecheck` — clean, 0 errors, re-run fresh just now.

**About to run the real-session e2e test** (`hud-e2e.test.ts`, just written, not yet executed) — the
slow/risky step: drives the REAL `createSession` (not the fake) through a real solvability tape via
a manually-pumped stubbed `requestAnimationFrame`, mounts a real `hud.ts` alongside it, and checks
the HUD's own live-computed final readout against `session.onComplete`'s payload AND against a real
`verifyReplay` call. Logging now, before running, per the cadence instruction.

## 2026-08-15T12:35Z — e2e green on the first run, repo-wide suite green, bundle size measured, build/size scripts still pass

`npx vitest run packages/web/test/hud-e2e.test.ts` — **green on the first run.** Numbers from its
own console output: pumped 2111 synthetic 144fps frames, `elapsedTicks=2110`, `payload.timeMs=14653`
`payload.boostMs=0`, HUD's own live-computed readout `"0:14.653"`/`"0:00.000"` — EXACTLY
`formatDuration(payload.timeMs)`/`formatDuration(payload.boostMs)`, byte-for-byte. `verifyReplay`:
`{"ok":true,"timeMs":14653,"boostMs":0,"ticks":2110}` — accepted at zero tolerance. This is the
literal check the task doc's verification section names as "the one that produces bug reports" and
it holds by construction (both sides use the identical `Math.round(ticks*1000/TPS)` formula — see
finding #8 — not by coincidence).

Added a second real-storage test to `hud-complete.test.ts`, since the brief's verification section
is explicit: "using T-10's real `recordBest` return", not a mimic. Replaced my hand-rolled
`makeBestStore` fixture's role in ONE new test with the actual `createStorage()` from
`storage/index.ts` (still real, still not mine to edit, just imported) — drove three completions
(first: both new, everything empty; second: strictly worse, neither new, real store unchanged;
third: strictly better, both new, real store updated) and asserted both the panel's own "NEW BEST"
badge count AND `storage.getBest()`'s real persisted value after each. Green on the first run.
`createStorage()` degrades to its in-memory fallback in this environment (confirmed via its own
`console.warn`, "localStorage unavailable... using an in-memory fallback" — expected, matches
storage/index.ts's own documented behaviour for a non-browser test env, not a bug).

Full repo suite: `npx vitest run` — **645 passed, 1 skipped, 0 failed.** Notably the 7 `api/test/`
failures the brief said were T-12's in-flight work are GONE now (T-12 must have landed a fix since
this session started) — not investigated further, not mine either way, just noting the count changed
from what the brief described. `npm run typecheck` — clean, 0 errors, re-run fresh.

**Bundle size** (esbuild --bundle --minify --format=esm --platform=browser, matching T-04's own
methodology since nothing wires hud/** into the real `main.ts` entry yet — see finding #4):
- `hud/index.ts` (everything: hud+pause+complete+toast+format+hints+colors, INCLUDING the
  transitively-pulled real `ui/dom.ts`+`ui/icons.ts`+`ui/screens/ingameMenu.ts` that `pause.ts`
  reuses): raw 14.13 KB, **gzip 5.34 KB**.
  - Of that, `pause.ts` alone (i.e. the T-08-reuse delta) is raw 4.54 KB / gzip 2.15 KB.
  - My own code with no `ui/` coupling at all (hud+toast+complete+format+hints+colors) is raw
    8.77 KB / **gzip 3.29 KB**.
- `hud.css`: raw 6.88 KB / **gzip 2.53 KB**.
- Total if wired in as-is: **~7.9 KB gzip** — 3.2% of the 250 KB budget.

Also confirmed the toolchain contract itself hasn't regressed: `npm run build -w @swingby/web`
succeeds (31 modules, no hud/** in the graph, exactly as finding #4 predicted) and `npm run size`
still **PASSES at 15.74 KB gzip / 234.26 KB under budget** — my files being unwired doesn't touch the
real build's output at all, confirmed rather than assumed.

### Next step

Dev harness (`hud/hud-dev.ts` + `hud/hud-dev.html`) for screenshots at 1280px/360px, then the
break/restore proof, then `results/T-09-GAUGE.md`. Logging again immediately before headless
Chromium (the next slow/risky step) once the harness is built.

## 2026-08-16T07:20Z — resumed after a usage-limit kill, per orchestrator's message

Orchestrator confirmed everything up to and including the bundle-size measurement survived intact,
and that the repo-wide suite is clean (646 passed/1 skipped/0 failed at the time of their check —
the 7 `api/test/` failures the original brief mentioned are confirmed gone, T-12 fixed them,
consistent with what I'd already independently observed and logged above). Re-verified on resume:
all 9 hud/** source files + hud.css + `__tests__/fakeDom.ts` present, `packages/web/test/hud*` (7
files, 47 tests) still green, `npm run typecheck` clean. `results/T-09-GAUGE.md` does not exist yet
— confirmed the main outstanding gap, matches the orchestrator's message.

Wrote the dev harness (`hud/hud-dev.html` + `hud/hud-dev.ts`) — uses the SCRIPTED fake session
(deliverable 5) for full deterministic control over every visual state (bounds-warning ramp, paused,
completion with/without a new best, toast burst), plus the REAL `createStorage()` (T-10) so the
completion panel's new-best behaviour shown in screenshots is genuine, not faked. This is a
layout/legibility harness — physics correctness is already proven by `hud-e2e.test.ts`'s real
`createSession` drive, not re-proven here. `npm run typecheck` clean after adding both files.

About to start the Vite dev server and drive it with headless Chromium via Playwright for
screenshots at 1280px and 360px (HUD, pause panel, completion panel) — logging now, before that,
per the cadence instruction. Chromium at `/opt/pw-browsers/chromium`, global playwright package at
`/opt/node22/lib/node_modules/playwright`, same paths the environment brief and T-04's own log
already confirmed present.

## 2026-08-16T07:25Z — screenshots captured, 2 real visual bugs found+fixed via the 360px set specifically, task complete

Vite dev server started (`--port 5197 --strictPort`, distinct from any other agent's port),
`/src/hud/hud-dev.html` confirmed serving (200). `/opt/pw-browsers/chromium` symlink resolves
straight to the chrome binary (not a directory — first launch attempt guessed a `chrome-linux/chrome`
subpath and failed; fixed by pointing `executablePath` at the symlink itself). Captured all 12
screenshots (hud/hud-bounds-warning/pause/complete-new-best/complete-not-best/toast-burst × 1280/360)
on the first successful launch.

**Reviewing the 360px set (not just confirming the capture succeeded) found two real bugs, exactly
the kind the orchestrator's message warned this class of check catches and a passing test suite
does not:**

1. **Pause panel had zero backdrop styling** — T-08's real `mountIngameMenu` classes
   (`.overlay`/`.dialog`/`.btn`) are defined in `styles/components.css`, which my dev harness wasn't
   loading (only my own `hud.css`). Fixed by adding a read-only `<link>` to T-08's real
   `styles/index.css` in `hud-dev.html` (not an edit to their file — a reference, same category as
   `pause.ts` importing their `mountIngameMenu` function). This ALSO surfaced bug #2 underneath it.
2. **Hint text bled through the (now-opaque) pause dialog**, faintly visible between "Restart level"
   and "Settings". Root cause: hint visibility was gated by the throttled ~10Hz tier only, so a
   snapshot stream that pauses between two throttled ticks (true for the harness's single-button-
   click pause, and possible if rare in real 144Hz play) left stale "sb-visible" text showing
   indefinitely — nothing ever arrived to trigger the next throttled tick and correct it. Fixed by
   splitting hud.ts's hint block: visibility now reacts to ANY status transition immediately
   (tracked via a new `lastEvaluatedStatus`/`statusChanged` check, `throttledTick || statusChanged`),
   text content re-evaluation stays on the normal throttle. Two regression tests added directly to
   `hud.test.ts` (hide-on-pause-with-no-further-ticks, and text-correctness-on-resume). Re-ran
   `packages/web/test/hud*`: 49/49 (up from 47 — the 2 new tests) before the next fix below.

**While fixing #2 and reviewing the completion-panel screenshot, found and fixed a THIRD, related
bug, this time via visual review rather than a pre-existing test:** the top-right "Best" stats line
stayed stuck at "Best —" even immediately after a completion that had just recorded a real best.
Root cause: `hud.ts`'s `refreshBest()`/`refreshSettings()` (and `setPauseIndicatorSuppressed()`)
only updated an internal cache — the actual DOM write still waited for the next throttled `subscribe`
tick, which never arrives on its own for a scripted/one-shot session (real 144Hz sessions self-
correct within ~100ms, invisible to a player, which is exactly why this didn't show up in the
hud.test.ts unit tests, which mostly drive many synthetic frames). This directly contradicted my own
doc comment's promise ("call this right after Settings closes for INSTANT feedback"). Fixed by
caching `lastSnapshot` and having all three methods re-render immediately against it, not just
update state silently. Added `mountGauge`'s own missing wiring at the same time — its composition
never called `hud.refreshBest()` after `complete.ts`'s `recordBest()` ran, which is the other half
of why the screenshot showed a stale value. Wrote a new dedicated test file,
`packages/web/test/hud-gauge.test.ts` (4 tests), covering `mountGauge`'s own cross-module wiring —
2 of its 4 tests failed on the FIRST run, which is what caught both halves of this bug precisely
(the pause-suppression ordering lag and the stale-best lag) before I'd have otherwise noticed via
screenshots alone a second time.

Re-captured all 12 screenshots after both rounds of fixes — reviewed again, both defects confirmed
gone (pause panel clean, no ghosting; "Best 0:09.200 · 0:00.150 boost" now shows immediately post-
completion in both the 1280 and 360 sets).

**Final verification, all run fresh at the end:**
- `npx vitest run packages/web/test/hud*` — **53/53 passed**, 8 files.
- `npx vitest run` (whole repo) — **760 passed, 1 skipped, 0 failed** (T-11/T-13 actively landing
  concurrent work in this same session — the total keeps growing run to run; 0 failures held every
  time I checked, most recently at 760).
- `npm run typecheck` — clean for every file I own, on every run. Saw transient errors in other
  tasks' in-progress files across different runs (`editor/editor.ts` then later
  `test/net-queue.test.ts`) — never the same file twice, never mine, confirmed each time via a
  targeted grep. Same transient-concurrent-save pattern T-05's own log documents independently.
- Bundle size (esbuild, unwired-module methodology, same as T-04): `hud/index.ts` (everything,
  including the real reused `ui/` chain) = 14.28 KB raw / **5.40 KB gzip**; own code only (no `ui/`
  coupling) = 8.77 KB raw / 3.29 KB gzip; `pause.ts` alone (the reuse delta) = 4.54 KB raw / 2.15 KB
  gzip; `hud.css` = 6.88 KB raw / 2.53 KB gzip. Total ~7.93 KB gzip, 3.2% of the 250 KB budget.
  `npm run build -w @swingby/web` + `npm run size` also re-confirmed passing (15.74 KB gzip, my
  files correctly absent from that build since nothing wires them in yet).
- Fail-proof: broke `format.ts`'s `ticksToMs` (`Math.round`→`Math.floor`), ran
  `packages/web/test/hud*`: **2 failed exactly** (`hud-e2e.test.ts`'s readout-agreement check,
  `hud-format.test.ts`'s direct formula check), **51 unaffected tests stayed green** (proving the
  suite doesn't fail wholesale on an unrelated change). Reverted the single line. Re-ran: 53/53
  green again, typecheck clean, e2e numbers (`0:14.653`, `verifyReplay` accept) identical to before.
- Zero forced-reflow reads: fresh `grep -rn "offsetWidth|offsetHeight|getBoundingClientRect|
  clientWidth|clientHeight" packages/web/src/hud/*.ts` — no matches in actual code.
- Zero imports from `render/` or `core/physics`: fresh grep of `^import` lines — no matches.
- `git status --porcelain` — confirms only `packages/web/src/hud/**` and `packages/web/test/hud*`
  (plus the new `packages/web/test/fake-session.ts`, already tracked) touched by me; visible
  `editor/**`/`net/**` changes in the working tree are other agents' concurrent work, never opened
  by me.

`results/T-09-GAUGE.md` written: all deliverables with path/status, the "working without a live
main.ts integration" framing (this task's actual scope boundary, not a shortfall), design decisions,
every number above transcribed with the exact console output, a "bugs found and fixed" section
covering all 4 real bugs from this task (toast destroy, fakeDom textContent, hint-visibility-lag,
refresh-doesn't-render) with root causes not just fixes, the full DoD checklist with one-line
reasons, the screenshot index with what-to-look-for per file including the two fixes each image now
demonstrates, and an explicit "what could not be verified" section (no real DevTools panel, no live
app wiring, assumed touch-zone geometry, the untestable `nearGoal` condition, T-13's rank slot only
exercised synthetically).

**Task complete.** Files owned and written, nothing else touched: all 12 files under
`packages/web/src/hud/**` (9 `.ts` + `.css` + `hud-dev.html` + `__tests__/fakeDom.ts`, plus 12
screenshots), `packages/web/test/fake-session.ts`, 8 files matching `packages/web/test/hud*.test.ts`,
this log, and `results/T-09-GAUGE.md`.
