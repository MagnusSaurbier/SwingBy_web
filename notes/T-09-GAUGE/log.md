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
