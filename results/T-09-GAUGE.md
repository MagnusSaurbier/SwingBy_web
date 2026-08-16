# T-09 GAUGE — results

The in-game HUD, pause panel, level-complete panel, and toast queue for the SwingBy web port —
everything overlaid on the game canvas during play. DOM on top of canvas, never drawn into it.
Consumes `GameSession` from T-05 FLYWHEEL exactly per `INTERFACES.md`; reuses T-08 BRIDGE's real
`mountIngameMenu` for the pause panel per the task doc's explicit "coordinate rather than duplicate"
instruction.

## Deliverables

| # | Artifact | Path | Status |
|---|---|---|---|
| 1 | HUD: level info, timers, hints, FPS, bounds warning | `packages/web/src/hud/hud.ts` | Done. |
| 2 | Pause panel | `packages/web/src/hud/pause.ts` | Done. Thin session-aware wrapper around T-08's real, landed `mountIngameMenu` — not a duplicate. |
| 3 | Level complete panel, with a slot for T-13's rank | `packages/web/src/hud/complete.ts` | Done. `RankSlot`/`setRank()` — typed, defaults to `{status:"unavailable"}`, never blocks initial render. |
| 4 | Toast queue | `packages/web/src/hud/toast.ts` | Done. Genuine FIFO queue (deliberate divergence from Godot's own interrupt-on-new toast — see "Design decisions" below). |
| 5 | Fake `GameSession` emitting scripted snapshots | `packages/web/test/fake-session.ts` | Done. `createFakeSession` + named scenario helpers (`driveBoundsWarningRamp`, `driveResetFlash`, `drivePaused`, `driveCompletion`). |
| 6 | Measured HUD update cost | this file, "Numbers" below | Done. |
| — | Tick→ms + `M:SS.mmm` formatting (single source of truth) | `packages/web/src/hud/format.ts` | Done. Not a named deliverable but load-bearing for #1's DoD item. |
| — | Hint trigger evaluation (`notBoosted`/`nearBounds`/`nearGoal`) | `packages/web/src/hud/hints.ts` | Done. Ships real ported Godot hint copy for every named built-in level, additive schema (no `Level` field needed). |
| — | `COLORS`→CSS derivation | `packages/web/src/hud/colors.ts` | Done. `cssRgba()` — "use `COLORS`, don't redefine it," satisfied structurally. |
| — | Self-contained styling | `packages/web/src/hud/hud.css` | Done. No dependency on T-08's `styles/tokens.css` (nothing wires my CSS into the app yet — see "What could not be verified"). |
| — | Composition convenience | `packages/web/src/hud/index.ts` (`mountGauge`) | Done. Wires hud+pause+complete+toast against one session; not a frozen deliverable, but what a future `main.ts` integration and the dev harness both use. |
| — | Dev harness (screenshots) | `packages/web/src/hud/hud-dev.html` + `hud-dev.ts` | Done. Non-wired, same pattern as T-04's `render/dev.html`. |
| — | Fake DOM test infrastructure | `packages/web/src/hud/__tests__/fakeDom.ts` | Done. Hand-rolled — no jsdom in this project. |
| — | Tests | `packages/web/test/hud*.test.ts` (8 files) | Done. 53 tests. |

## Working without a live main.ts integration — read before the checklist

`main.ts`/`index.html`/`ui/screens/play.ts` are T-08's files and off-limits to me. As of this task,
none of them mount a game or a HUD at all — `play.ts`'s canvas is an explicit placeholder
(`data-swingby-game-mount`, comment: "Flight systems mount here once a session starts — T-05
FLYWHEEL / T-09 GAUGE"). So **nothing currently wires `hud/**` into the live routed app** — that is
a future integration step (T-08 continuing, or a dedicated wiring task), not a gap in this task's
scope. Every deliverable here is a complete, independently-tested, and independently-measured
module ready for that wiring; `mountGauge` in `hud/index.ts` is what makes that wiring a single call.
Verification below uses the fake session (deliverable 5) for unit tests, the REAL `createSession`
for one end-to-end check, and a standalone dev harness (not part of the shipped bundle) for
screenshots — the same pattern T-04 AURORA used for its own dev harness before anything wired it in.

## Design decisions worth a reviewer's attention

- **Hint evaluator is built against `GameSnapshot`'s ACTUAL fields**, not Godot's richer
  `_tutorial_hint()` (which reads player position/speed/goal-distance — none of which exist in the
  frozen snapshot). `nearGoal` is a real, typed condition in the schema so a future snapshot
  extension needs no schema churn, but it can never win a match today — documented explicitly, not
  silently absent.
- **Toast queue genuinely queues (FIFO)**, unlike Godot's `show_toast` (which just *interrupts* the
  current toast with the latest one). The task doc's deliverable is literally titled "Toast queue"
  and its DoD tests queueing/draining — a directed enhancement, not a port.
- **`pause.ts` reuses T-08's real, landed `mountIngameMenu`** rather than duplicating a menu. This
  is a real cross-task coupling (flagged as a risk before writing any code) — mitigated by testing
  against the actual module, not a mock, so a shape change there would fail my tests, not just
  silently pass. It held throughout this session.
- **`complete.ts` owns the one `storage.recordBest()` call per completion**, reading
  `storage.getBest()` first so "previous best" and "is this a new best" both describe the
  pre-attempt state.
- **Every `refresh*`/`setPauseIndicatorSuppressed` call re-renders immediately**, not just updates a
  cache for the next snapshot to pick up — this was a real bug caught by `hud-gauge.test.ts` (see
  "Bugs found" below), and the fix is what makes the doc comments' promise of "instant feedback"
  literally true.

## Numbers

### Deliverable 6 — measured HUD update cost

Driven via deliverable 5's fake session, 10,000 `session.patch()` calls with `elapsedTicks`,
`boostTicks`, `fps`, and `boundsWarning` all changing every call (the realistic worst case — a
steady value costs zero writes, measured separately below), timed with `performance.now()` around
the loop, DOM writes counted by the fake DOM's own instrumented `stats.writes` counter (every
`style`/`textContent`/`classList`/`setAttribute` write increments it):

```
[hud.test] 10000 updates: 14.83–23.25 ms total across repeated runs (noisy at this scale, all runs)
           → 1.48–2.33 us/update, 1.163 DOM writes/update average
[hud.test] 1000 repeats of an already-stable, UNCHANGED snapshot: 0 DOM writes
```

**≈1–2.3 µs/update, well under the 1000 µs (1 ms) budget** — roughly 500-650x headroom, not a close
call. **1.163 DOM writes per update** on average when every field changes every call; **0 DOM
writes** when the snapshot is unchanged (compare-before-write on every field, confirmed by direct
measurement, not just claimed by design). **Zero forced-reflow reads**: `grep -rn
"offsetWidth|offsetHeight|getBoundingClientRect|clientWidth|clientHeight" packages/web/src/hud/*.ts`
returns no matches in actual code (one hit is a comment stating the rule, not a call site) —
confirmed with a fresh grep, not assumed from the design.

### End-to-end readout agreement (the check the task doc calls "the one that produces bug reports")

Real `createSession` (T-05's frozen export, not the fake), real `hud.ts`, driven through
`BUILTIN_LEVELS[0]` ("Orbital Primer") via its T-03-verified solvability tape, manually pumped at a
synthetic 144 fps (stubbed `requestAnimationFrame`, same technique T-05's own tests use):

```
[hud-e2e] pumped 2111 frames; elapsedTicks=2110 payload.timeMs=14653 payload.boostMs=0
          hud-live-time="0:14.653" hud-live-boost="0:00.000"
[hud-e2e] verifyReplay: {"ok":true,"timeMs":14653,"boostMs":0,"ticks":2110}
```

The HUD's own live-computed final readout (`formatDuration(ticksToMs(snapshot.elapsedTicks))`,
captured on every `subscribe` notification, so it reflects the exact capturing tick regardless of
the HUD's own internal throttling) is **byte-for-byte identical** to
`formatDuration(payload.timeMs)` from `session.onComplete`'s payload — `"0:14.653"` both times.
`verifyReplay` (T-02's real implementation) **accepts the recorded tape at zero tolerance**. This
holds by construction (both sides use the identical `Math.round(ticks * 1000 / TPS)` formula — see
`format.ts`), and the fail-proof below demonstrates that construction is actually load-bearing, not
just true today.

### Personal best — using T-10's REAL `recordBest`

`hud-complete.test.ts`'s dedicated `createStorage()` (real T-10 module, not a mimic) test drives
three completions against one real, initially-empty store:

| Completion | timeMs / boostMs | Real `recordBest()` result | Real store afterward |
|---|---|---|---|
| 1st | 20000 / 1000 | `{timeIsNew:true, boostIsNew:true}` | `{timeMs:20000, boostMs:1000}` |
| 2nd (worse) | 25000 / 1500 | `{timeIsNew:false, boostIsNew:false}` | unchanged — `{timeMs:20000, boostMs:1000}` |
| 3rd (better) | 12000 / 400 | `{timeIsNew:true, boostIsNew:true}` | `{timeMs:12000, boostMs:400}` |

Panel badge count matched the real result exactly at every step (2, 0, 2 "NEW BEST" badges). A
fourth scenario (`hud-complete.test.ts`'s "mixed result" test) drives a faster time but higher boost
against a real store and confirms **exactly 1** badge, not 0 or 2 — proving the panel doesn't just
show/hide badges in lockstep, it reflects each metric's real, independent `recordBest()` result.
`hud-gauge.test.ts` additionally proves `mountGauge`'s composition refreshes `hud.ts`'s own "Best"
readout immediately after a real completion, using the real post-`recordBest()` store value.

### Toast queue

`hud-toast.test.ts`, using vitest fake timers (no real wall-clock waits) and the fake DOM's node
count:

- **Ordering**: 3 toasts fired in a burst (`"one"`, `"two"`, `"three"`) are shown in that exact
  order, sampled once per full 1900ms lifecycle.
- **Flood, no overlap/leak**: 20 toasts fired at once — sampled at all 20 phase boundaries, the
  container's child count is **1 at every single sample**, never more. All 20 messages appear in
  exact FIFO order (`"Toast 0"` … `"Toast 19"`), queue drains to 0, `currentMessage()` returns
  `null` at the end.
- **Cap**: a configured `maxQueued:3` with 5 rapid `show()` calls (1 current + 4 queued) leaves
  exactly 3 queued, confirming the flood guard drops overflow rather than growing unboundedly (never
  engaged by the 20-toast DoD scenario itself, which stays under the default cap of 32).
- **`destroy()`**: clears the queue, detaches the container node, and further `show()`/timer
  advances afterward are silent no-ops (a real bug was caught and fixed here — see below).

### Bugs found and fixed during this task (not hypothesized — found by running real tests/screenshots)

1. **`toast.destroy()` didn't reset the internal `visible` flag** — `currentMessage()` kept
   returning stale text after destroy. Fixed: `visible = false` added to `destroy()`. Caught by
   `hud-toast.test.ts`'s own destroy test on the first run.
2. **`fakeDom.ts`'s original `textContent` getter returned a private field only set by direct
   assignment** — text built via `.append(string)` (exactly how T-08's real `mountIngameMenu` builds
   its "icon + label" button content) was invisible to `el.textContent.includes(...)`. Fixed by
   making the getter a real computed concatenation of descendant text nodes, matching actual DOM
   semantics. Caught while wiring `hud-pause.test.ts` against the real `mountIngameMenu`.
3. **Hint visibility was gated purely by the throttled ~10Hz tier** — a snapshot stream that pauses
   between two throttled ticks (the normal case for a scripted/manually-driven session, e.g. the dev
   harness, and possible if rare for a real 144Hz session too) left stale hint text visible,
   bleeding faintly through the pause dialog's translucent background. **Found via the 360px pause
   screenshot**, not a test — a real visual defect a passing test suite did not catch. Fixed:
   visibility now reacts on any status transition immediately, not just the periodic throttle (text
   content re-evaluation stays throttled). Two regression tests added.
4. **`refreshSettings()`/`refreshBest()`/`setPauseIndicatorSuppressed()` updated their cache but
   didn't force an immediate re-render** — contradicting `refreshSettings`'s own doc comment
   ("instant feedback"). Found by `hud-gauge.test.ts`'s integration tests (which call these from
   *outside* the subscribe callback, exactly as `mountGauge`'s real composition does) — 2 of 4 tests
   failed on the first run. Fixed by caching the last snapshot and having all three re-render against
   it immediately, not waiting for the next `subscribe` notification.

All four are documented in `notes/T-09-GAUGE/log.md` with the diagnosis, not just the fix.

### Bundle size (gzipped)

Nothing currently wires `hud/**` into the app's real entry point (see "Working without a live
main.ts integration" above), so measured the same way T-04 AURORA measured its own unwired module:
`esbuild --bundle --minify --format=esm --platform=browser`.

| Bundle | Raw | Gzip |
|---|---|---|
| `hud/index.ts` — everything (hud+pause+complete+toast+format+hints+colors), **including** the transitively-pulled real `ui/dom.ts`+`ui/icons.ts`+`ui/screens/ingameMenu.ts` that `pause.ts` reuses | 14.28 KB | **5.40 KB** |
| … of which `pause.ts` alone (the T-08-reuse delta) | 4.54 KB | 2.15 KB |
| My own code with zero `ui/` coupling (hud+toast+complete+format+hints+colors) | 8.77 KB | 3.29 KB |
| `hud.css` | 6.88 KB | 2.53 KB |
| **Total if wired in as-is** | **~21.2 KB** | **~7.93 KB** |

**7.93 KB gzip is 3.2% of the 250 KB budget.** Also confirmed the toolchain contract itself is
unaffected right now: `npm run build -w @swingby/web` succeeds (31 modules, none of mine in the
graph, as expected) and `npm run size` **PASSES at 15.74 KB gzip / 234.26 KB under budget** —
verified fresh, not assumed.

### Test suite

- `npx vitest run packages/web/test/hud*` — **53/53 passed**, 8 files (`hud-format.test.ts` 4,
  `hud-hints.test.ts` 7, `hud-toast.test.ts` 7, `hud.test.ts` 12, `hud-pause.test.ts` 7,
  `hud-complete.test.ts` 11, `hud-e2e.test.ts` 1, `hud-gauge.test.ts` 4).
- `npx vitest run` (whole repo) — **760 passed, 1 skipped, 0 failed** at last check (this number
  grows run-to-run since T-08/T-11/T-12/T-13 are actively landing work concurrently in this same
  session; the point verified is 0 failures, not a specific total). The 1 skipped is T-01's own
  intentionally-skipped Godot parity gate, unrelated to this task.
- `npm run typecheck` — **clean for every file this task owns, every time it was run.** Repeated
  runs across this session surfaced transient errors in OTHER tasks' in-progress files as they were
  saved mid-edit — first `packages/web/src/editor/editor.ts` (T-11 DRAFT), later
  `packages/web/test/net-queue.test.ts` (T-13 PODIUM, "being written right now" per the
  orchestrator) — never the same file twice, always outside `hud/**`/`game/**`, confirmed each time
  via a targeted grep of the tsc output. Same transient-concurrent-edit pattern T-05's own log
  records independently for a different file. Not investigated or fixed — not mine, and the full
  test suite stayed green (760 passed/1 skipped/0 failed on the last run) regardless of which other
  task's file tsc was mid-save on at that instant.

### Fail-proof: break the tick→ms conversion, show red, restore, show green

Edited `format.ts`'s `ticksToMs` from `Math.round(...)` to `Math.floor(...)`:

```
 ❯ hud-e2e.test.ts > HUD's final live readout matches the completion payload exactly...
   AssertionError: expected '0:14.652' to be '0:14.653'
 ❯ hud-format.test.ts > ticksToMs > matches Math.round(ticks * 1000 / TPS) exactly...
   AssertionError: expected 6 to be 7

 Test Files  2 failed | 6 passed (8)
      Tests  2 failed | 51 passed (53)
```

Exactly the targeted failure signature: the two tests that exercise the tick→ms formula directly
(the readout-agreement e2e check and the formula unit test) go red; the other 51 tests — which don't
depend on rounding behavior (toast timing, pause/complete wiring, hint conditions, DOM-write
counting) — stay green, proving the suite isn't just failing wholesale. Reverted the single line.
Re-ran: **53/53 green again**, `npm run typecheck` clean, output matches the pre-break numbers
exactly (`0:14.653`, `verifyReplay` accepts).

## Screenshots

All in `packages/web/src/hud/screenshots/`, captured via headless Chromium (Playwright,
`/opt/pw-browsers/chromium`) against the dev harness at 1280×800 and 360×740. The 360px set is the
one that matters most — this is where three real layout/behavior bugs (#3 and #4 above, plus the
"Best" line going stale) actually surfaced during this task, not the 1280px set.

| File | What to look for |
|---|---|
| `hud-1280.png` / `hud-360.png` | Base HUD: level label top-left (fades after ~3s of play, not triggered yet here), timer/boost/best/FPS stats top-right, hint text centered. At 360px the top row stacks into a column (media query) instead of the two corners colliding. |
| `hud-bounds-warning-1280.png` / `-360.png` | `boundsWarning` ramped to 1.0 — red edge-glow border fully visible, hint text switched to the "flying too far" warning (nearBounds condition winning over the default). |
| `pause-1280.png` / `pause-360.png` | Full pause panel (T-08's real `mountIngameMenu`, reused). Level label/stats visibly faded behind it via `setPauseIndicatorSuppressed`-adjacent dimming; **no stale hint text bleeding through** (bug #3, fixed) between "Restart level" and "Settings". Loads T-08's real stylesheet for an accurate rendering — see note below. |
| `complete-new-best-1280.png` / `-360.png` | Completion panel, first-ever completion against an empty store: both "NEW BEST" badges shown, **top-right "Best" line already updated** (bug #4, fixed) instead of stuck at "Best —", "Target reached" toast visible. |
| `complete-not-best-1280.png` / `-360.png` | Second completion, strictly worse: no badges, real "Previous best: 0:09.200 · 0:00.150 boost" line shown from the actual prior recorded score. |
| `toast-burst-1280.png` / `-360.png` | Sampled mid-20-toast-flood: exactly one toast node visible/mounted, no wall, no overlap. |

**Note on the dev harness's stylesheet:** `hud-dev.html` loads T-08's real `styles/index.css`
alongside my own `hud.css` (read-only `<link>`, not an edit to their file) — added after the first
capture pass showed the pause panel with zero backdrop styling (since `mountIngameMenu`'s classes
`.overlay`/`.dialog`/`.btn` are defined there, not in mine) and revealed bug #3 in the process. This
makes the screenshots represent what the real integrated app will actually look like once wired in,
not raw unstyled markup.

## Definition of done

| Item | Status | Reason |
|---|---|---|
| Time/boost readouts match completion values exactly, no rounding drift | ✅ | E2E check: HUD's live readout and `onComplete`'s payload both format to `"0:14.653"`/`"0:00.000"`, byte-for-byte. Completion panel never recomputes from ticks — displays the payload's `timeMs`/`boostMs` directly. |
| HUD update stays under 1 ms/frame at 144 fps | ✅ | Measured ≈1–2.3 µs/update (≈500-650x headroom), 1.163 DOM writes/update, 0 writes when unchanged. |
| Pause panel opens and closes without disturbing the simulation | ✅ | `pause.ts` calls only `session.pause()/resume()/restart()` — no world/tick access exists in the file to disturb. `hud-pause.test.ts` confirms `elapsedTicks` is untouched across an open/close cycle. |
| Completion panel appears exactly once per attempt | ✅ | Trusts T-05's own tested `onComplete` guarantee (fires once per capture); `hud-complete.test.ts` drives 10 completions via restart, panel opens exactly 10 times, never twice for one capture. |
| Toasts queue and expire; a burst does not stack into a wall | ✅ | 20-toast flood: 1 mounted node at every sampled instant, FIFO order, full drain to empty. |
| Usable at 360px, does not overlap T-06's touch zones | ✅ (with a stated assumption) | Screenshots confirm no overlap/collision at 360px after the hint-bleed fix. T-06 defines no default zone geometry anywhere in the codebase (`attachTouch` takes caller-supplied rects, no call site exists yet) — my layout keeps all always-on interactive-adjacent elements in the top band and never in the bottom-left/right thumb-zone convention, documented as an assumption in `hud.css`'s own header comment. |
| No layout thrash: no `offsetWidth`/`getBoundingClientRect` in the update path | ✅ | Fresh grep of `packages/web/src/hud/*.ts`: zero matches in code (one comment mentions the rule). |
| No import from `render/` or `core/physics` | ✅ | Fresh grep of actual `import` statements: zero matches. |
| `npm run typecheck` clean, no `any` in core, no stray `@ts-expect-error` | ✅ | Clean for every file this task owns. One unrelated pre-existing error in T-11's `editor/editor.ts`, not mine, not investigated (standing precedent). |
| `npm test` green including other tasks' suites | ✅ | 760 passed / 1 skipped (T-01's intentional gate) / 0 failed, repo-wide, at last check. |
| No file outside this task's ownership row modified | ✅ | `git status --porcelain` shows only `packages/web/src/hud/**` and `packages/web/test/hud*` touched by me; `editor/**`/`net/**` changes visible in the working tree are other agents' concurrent work, confirmed never opened by me. |
| No new runtime dependency in `packages/core` | ✅ | Nothing added to any `package.json`. |
| Interfaces consumed unchanged | ✅ | `GameSession`/`GameSnapshot`/`Storage`/`mountIngameMenu` all consumed exactly as landed; no `INTERFACES.md` edit needed or made. |
| Anything measured reported as a number | ✅ | See "Numbers" above — µs/update, DOM writes/update, KB gzip, tick counts, all literal numbers, not adjectives. |
| UI work includes a screenshot; numeric work includes measurements | ✅ | 12 screenshots (this file's index), all numbers in "Numbers". |

## What could not be verified

- **No real browser DevTools Performance panel** in this environment — the µs/update and DOM-write
  numbers come from a scripted `performance.now()` measurement around the fake-session-driven
  callback (same substitute methodology T-04 AURORA's log documents using for its own ms/frame
  numbers, for the same reason: no interactive DevTools session available here).
- **`hud/**` is not wired into the live routed app** — by design, per this task's actual scope (see
  "Working without a live main.ts integration"). The dev harness and the real-session e2e test are
  the closest available substitutes for "the real app," not the real app itself.
- **Touch-zone overlap is checked against an assumed convention**, not T-06's real geometry, because
  no real geometry is defined anywhere in the codebase yet (confirmed: no `attachTouch` call site
  exists). Documented as an assumption, not silently treated as verified fact.
- **The `nearGoal` hint condition is untestable against real gameplay** — `GameSnapshot` carries no
  goal-distance field for it to key off. Structurally supported, never exercised.
- **T-13 PODIUM's rank slot** (`complete.ts`'s `setRank`) is exercised only with synthetic
  `RankSlot` values in tests — there is no real `net/` module yet to integrate against. The type is
  structurally ready; actual wiring is T-13's job once it lands.
