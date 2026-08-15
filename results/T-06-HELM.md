# T-06 HELM — Results

Keyboard, touch, and gamepad input, unified into one `InputSource`, polled once per simulation
tick. Area `packages/web/src/game` (my slice only — `input.ts`, `touch-zones.ts`, `input-dev.html`,
and the test file; `loop.ts`, `camera.ts`, `bounds.ts` are T-05 FLYWHEEL's and `audio.ts`/
`audio-voices.ts`/`audio-dev.html` are T-07 CHORUS's, all landed concurrently in the same
directory during this task and untouched by me).

## File-ownership history — read this first

Early in this task, this session's orchestrator instructions were stricter than the task doc:
"Write only `packages/web/src/game/input.ts` and your tests... Touch only `input.ts` and your own
test file. Nothing else anywhere." I followed that rule at the time — touch-zone hit-testing was
folded directly into `input.ts` instead of a separate module, and no dev page was committed to the
repo (an equivalent harness was built in the scratchpad directory purely for my own
headless-Chromium verification). Both deviations were flagged explicitly in this file and in
`notes/T-06-HELM/log.md` rather than silently dropped.

**The coordinator has since corrected this**, confirming the task doc's file list is the real
spec and widening this task's ownership to include the two files that were withheld. Both have now
landed:

- **`packages/web/src/game/touch-zones.ts`** — touch zone geometry and hit-testing
  (`pointInRect`, `classifyPoint`), split back out of `input.ts`. Behaviour-preserving: the
  original 32 tests kept passing unchanged through the split, and 4 new tests were added that
  exercise `touch-zones.ts` directly (36 total). See "The touch-zones.ts split" below.
- **`packages/web/src/game/input-dev.html`** — the dev page, live `InputState`, drained
  `ControlAction` queue, and the actual touch zone rectangles drawn on screen. See "The
  input-dev.html page and the real-phone check" below — **this is the important one**, since
  deliverable 5 (a phone video/screenshot) cannot exist until this page does.

**One more divergence, explicitly sanctioned by the coordinator rather than corrected:** the task
doc lists the test path as `packages/web/test/input.test.ts`. My tests live at
`packages/web/src/game/__tests__/input.test.ts` instead — this matches the `__tests__/` convention
T-10 VAULT already established elsewhere in `packages/web/src/`, needs no extra vitest config
(default discovery picks it up either way), and keeps the test file physically next to the two
modules it tests. The coordinator reviewed this and said explicitly: "your location is honestly
the better one... I am NOT asking you to move it." Recorded here as an intentional, approved
decision, not an oversight.

## Deliverables

| # | Artifact | Path | Status |
|---|---|---|---|
| 1 | `createInputSource` + the `InputSource` interface (exact INTERFACES.md signatures: `poll`, `drainEvents`, `setBindings`, `attachTouch`, `destroy`) | `packages/web/src/game/input.ts` | **Done** |
| 2 | Touch zone geometry and hit-testing | `packages/web/src/game/touch-zones.ts` (`pointInRect`, `classifyPoint`) | **Done — landed** (originally folded into `input.ts`, split back out per the coordinator's ownership widening; see "The touch-zones.ts split" below) |
| 3 | Unit tests for polling, edge events, binding matching, touch, blur, destroy, gamepad, and now `touch-zones.ts` directly | `packages/web/src/game/__tests__/input.test.ts` (36 tests) | **Done** — path divergence from the task doc's `packages/web/test/input.test.ts` explicitly approved by the coordinator, see above |
| 4 | Dev page showing live `InputState`, drained events, and the touch zone rectangles | `packages/web/src/game/input-dev.html` | **Done — landed.** See "The input-dev.html page and the real-phone check" below |
| 5 | Video/screenshot of the dev page on a real phone | — | **BLOCKED — host-only.** No physical phone is reachable from this environment; this can only be produced by a human on real hardware. The page it depends on now exists (deliverable 4) — see below for the exact URL and what to look for. |

## Definition of done

- [x] `poll()` allocates nothing — heap profile over 10,000 calls. Measured two ways (Node
  approximation + a real-Chromium measurement with a calibrated allocating control); see
  "Allocation" below for the actual numbers. Real-Chromium result: **1.51 bytes/call measured
  growth vs. 18.09 bytes/call for a deliberately-allocating control of the same object shape —
  about 12x smaller**, and almost none of it is GC-reclaimable (meaning it isn't `poll()`-sourced
  garbage at all). Reported as the measured number, not "zero", per PROJECT.md §7.
- [x] Held edge-triggered keys fire **exactly once** — `edge-triggered input (drainEvents)` describe
  block: a single keydown → one action; 500 synthetic OS-repeat (`repeat:true`) keydowns after the
  first → still exactly one; two distinct actions between polls → both delivered, in order, no
  loss/duplication; the same action released-then-re-pressed between polls → two entries (correct,
  not a violation — it's two genuinely separate presses).
- [x] Simultaneous boost + brake on touch both register — `touch` describe block, two-identifier
  test, confirmed both in the Node fake-double suite AND against real `Touch`/`TouchEvent`
  constructors in headless Chromium (see below).
- [x] `touchcancel` and window `blur` release everything — no stuck inputs. `touchcancel` tested
  directly (Node + real browser). Window `blur` tested via `target`-level blur in Node (documented
  reason: Node has no `window` global at all) **and confirmed via a real `window.dispatchEvent(new
  Event("blur"))` in headless Chromium** — see "Real-browser verification".
- [x] Bindings work on QWERTZ and QWERTY unchanged (`code`, not `key`) — two dedicated tests
  dispatch events with deliberately mismatched `code`/`key` pairs (e.g. `code:"Space", key:"e"`
  and `code:"Digit1", key:"Space"`) and prove matching follows `code` only, in both the Node suite
  and a real-browser `KeyboardEvent`.
- [x] Rebinding persists via T-10 VAULT's settings object — you never touch `localStorage`.
  `setBindings(Record<ControlAction,string>)` is the only mutation path; a dedicated test
  (`this module never touches localStorage`) reads `input.ts`'s own source text and asserts the
  string `localStorage` does not appear anywhere in it.
- [ ] **BLOCKED — Verified on a real phone, not an emulator or a narrow desktop window.** Not
  possible from inside this environment (no physical device, no way to attach one to a headless
  container). The instrument this needs (`input-dev.html`) is now built and confirmed working in
  headless Chromium (real `hasTouch:true` multi-touch, real `Touch`/`TouchEvent` constructors) —
  see "The input-dev.html page and the real-phone check" below for the exact URL and checklist to
  hand to a human with a phone.
- [x] No dependency on `loop.ts`, `render/`, or `ui/` — `input.ts`'s only imports are
  `type { ControlAction, InputState }` + `DEFAULT_CONTROLS` from `@swingby/core` and
  `classifyPoint`/`pointInRect`/`type TouchZones` from its own sibling `./touch-zones.js`; grepped
  the file to confirm no other import exists.
- [x] Plus the global checklist in PROJECT.md §7 — see "Full verification" below.

## Two kinds of input, and the reference findings behind the split

Full trail with file:line citations is in `notes/T-06-HELM/log.md`. Summary:

- `reference/godot/scripts/InputHandler.gd:54-80` routes exactly `restart`/`pause`/`menu`/
  `toggleFps`/`toggleHighscores` through an edge-triggered signal path; `boost`/`brake`/thrust are
  **not** in that file at all — confirmed they're read continuously elsewhere
  (`PhysicsEngine.gd:105-112`). This is the source-level confirmation of the 6-continuous /
  5-edge split.
- `InputHandler.gd:44`: `_unhandled_input` only reacts to `pressed and not echo` — Godot's own
  OS-key-repeat guard. Direct web equivalent: edge actions check `KeyboardEvent.repeat` and skip
  when true; continuous actions don't care (a `Set.add` is idempotent).
- `PhysicsEngine.gd:105-106` (not `InputHandler.gd`, which has no gamepad code at all) is the
  actual source of the gamepad mapping: `boost = button A or right shoulder`,
  `brake = button B or left shoulder`. Ported to the Web Gamepad API's standard mapping:
  `buttons[0]`=A, `buttons[1]`=B, `buttons[4]`=left shoulder, `buttons[5]`=right shoulder.
- `PhysicsEngine.gd:107-112` is the source of the thrust-direction formula:
  `thrustX = (thrustRight held) - (thrustLeft held)`, `thrustY = (thrustDown held) - (thrustUp
  held)` — each an exact -1/0/1, never diagonal-normalized. Ported as-is even though `SIDE_THRUST`
  is currently `0.0` (per the task doc: "the contract is defined and the constant may change").
  `attachTouch`'s zones are boost/brake rects only (no directional touch zone in the frozen
  interface), so touch never contributes to `thrustX`/`thrustY` — only keyboard does.

## Rebind conflict policy

The task doc offered two acceptable options for "two actions bound to the same code": reject the
call, or unbind the loser. **Chose: unbind the loser.** Deterministic rule: `ACTION_ORDER` (fixed
to `Object.keys(DEFAULT_CONTROLS)` order: boost, brake, thrustUp/Down/Left/Right, restart, pause,
menu, toggleFps, toggleHighscores — **not** the input record's own key order, since that isn't
something a caller should be assumed to control). The action later in this order keeps a
contested code; the earlier one's binding becomes `""` (a sentinel that can never equal a real
`KeyboardEvent.code`, which is always non-empty). Covered by a unit test (`boost` and `brake` both
set to `"Space"` → `brake` wins, `boost` reads as unbound).

**Pending-rebind / cancel UX has no home inside `input.ts`.** The frozen `InputSource` interface
has exactly 5 methods — no rebind-session API. Capturing "the next keypress" for a rebind screen
is T-08 BRIDGE's responsibility on its own listener; `input.ts` only owns what happens once a
caller commits via `setBindings(...)`. Flagged explicitly since the task doc's "support cancelling
a pending rebind" phrasing could otherwise read as a missed requirement — it's a considered
interface-fidelity decision, detailed in the log's "Rebind API gap" entry.

## The touch-zones.ts split

`packages/web/src/game/touch-zones.ts` now holds the two pure functions that used to live inside
`input.ts`'s closure:

```ts
export interface TouchZones { boost: DOMRect; brake: DOMRect; }
export type ZoneName = "boost" | "brake";
export function pointInRect(x: number, y: number, rect: DOMRect): boolean;
export function classifyPoint(zones: TouchZones | null, x: number, y: number): ZoneName | null;
```

No behaviour change: `pointInRect` is the exact same inclusive-bounds comparison
(`x >= left && x <= right && y >= top && y <= bottom`) that was previously named `inRect` inside
`input.ts`, and `classifyPoint` is the same boost-checked-before-brake logic previously named
`classifyTouch` — only now it's a pure function taking `(zones, x, y)` instead of a closure over
`input.ts`'s private `touchZones` variable, so it's independently testable and independently
importable. `input.ts` imports both (`classifyPoint`, `pointInRect`, `type TouchZones`) and uses
them exactly where the inlined versions used to sit — in `onTouchStart` (classification) and
`onTouchMove` (re-checking a tracked touch against its own zone, to detect "dragged off").

**Proof it's behaviour-preserving:** the original 32 tests (written against `input.ts`'s public
`InputSource` interface, never against its internals) needed zero changes and still pass
unchanged after the split. 4 new tests were added in a dedicated `describe("touch-zones.ts:
pointInRect / classifyPoint", ...)` block that imports and calls the extracted module directly:
inclusive-bounds edge cases (all four rect edges), `classifyPoint(null, ...)` returns `null`
before any zone is attached, boost-vs-brake-vs-outside-both classification, and the documented
overlap tie-break (boost wins when zones overlap — an arbitrary-but-deterministic behaviour, not a
claim that overlapping zones are a supported layout). **36/36 passing** — see "Full verification"
below for the exact command and repo-wide numbers.

## The input-dev.html page and the real-phone check

`packages/web/src/game/input-dev.html` is a standalone page, served by
`npm run dev -w @swingby/web` (same pattern as T-04 AURORA's `render/dev.html` — not part of the
shipped app, never referenced by T-08 BRIDGE's `main.ts`/`index.html`). It creates one real
`InputSource` against the whole page (`createInputSource(document.getElementById("page"))`) and
renders, live, updated every animation frame:

- **`InputState`** — `boost`/`brake` (highlighted green when held), `thrustX`/`thrustY`, and a
  measured poll rate (confirms the rAF loop is actually calling `poll()` every frame, not stalled).
- **The drained `ControlAction` queue** — every action `drainEvents()` returns is appended, with a
  millisecond timestamp, to an on-screen log panel (capped at the 60 most recent lines).
- **The touch zone rectangles, drawn as real DOM elements** — a `BRAKE` panel and a `BOOST` panel,
  each labeled with its current keyboard binding. `attachTouch()` is called with
  `getBoundingClientRect()` of these exact elements (re-synced on `resize` and `orientationchange`,
  since the panels are a CSS grid, not fixed pixel rects), so **what's drawn on screen is exactly
  what's being hit-tested** — nothing hidden or approximated. Each panel visibly fills/lights when
  its control is held, so a stuck-or-not-registering zone is obvious without reading any numbers.

**Verified working before handoff** (headless Chromium, `hasTouch:true` context, real
`Touch`/`TouchEvent`/`KeyboardEvent` constructors dispatched at the live page — not a fake double,
the actual bundled behaviour served by `npm run dev`):

| Check | Result |
|---|---|
| Page loads, `createInputSource` attaches, zones report real non-zero `getBoundingClientRect()`s | ✅ boost/brake panels ≈172×253px each on a 390×844 viewport — comfortably thumb-sized |
| Real `KeyboardEvent{code:"Space"}` keydown → `boost` text flips to `true`, panel highlights | ✅ |
| Keyup → releases back to `false` | ✅ |
| Real `Touch`/`TouchEvent` tap inside the boost panel → registers `true` | ✅ |
| Two simultaneous touches, one per panel → **both** `true` at once (multi-touch) | ✅ (screenshot: `input-dev-multitouch.png` in this session's scratchpad) |
| `KeyR` (restart) → appears in the drained-event log panel with a timestamp | ✅ |
| Landscape viewport (844×390) → layout holds, both panels stay full-size and reachable, no overlap | ✅ (screenshot: `input-dev-landscape.png`) |
| Console/page errors | None from the app itself (one harmless `favicon.ico` 404 — confirmed pre-existing on this dev server for every page, including T-04's own `render/dev.html` and the main `index.html`, neither of which defines a favicon either; not introduced by this page) |
| Layout bug found and fixed during this check | The drained-event log panel's vertical position was a hardcoded CSS `top`, which overlapped the HUD's keyboard-hint text on a narrow (390px) viewport once that text wrapped to 2 lines. Fixed by computing the panel's `top` from the HUD's actual measured `getBoundingClientRect().bottom` in JS (`syncLogPanelPosition()`), re-run on the same `resize`/`orientationchange` listeners as the touch zones — robust to any HUD height, not a magic number. Confirmed fixed with a second screenshot. |

**Exact URL for Magnus to open on his phone**, on the same LAN as the machine running the dev
server:

```
npm run dev -w @swingby/web -- --host
```

then, on the phone's browser:

```
http://<the machine's LAN IP>:5173/src/game/input-dev.html
```

**What to look for** (this is deliverable 5 — a screen recording or a few screenshots covering
these, attached wherever this task's PR/handoff happens):

1. **Reachability.** Hold the phone one-handed, both portrait and landscape. Are BOOST and BRAKE
   both comfortably under a thumb, or does one need a stretch / the other hand? (This placeholder
   layout — two side-by-side panels — is not the final HUD; T-08 BRIDGE owns real placement. But
   panel *size* and general one-handed feel are already meaningful signal here.)
2. **Latency.** Tap BOOST. Does the label flip to `true` and the panel light up the instant the
   thumb lands, or is there visible lag?
3. **Multi-touch.** Hold BOOST with one thumb, then also touch BRAKE with the other hand/thumb
   without releasing the first. Do both read `true` simultaneously?
4. **Drag-off release.** Press BOOST, then slide the thumb off the panel without lifting. It
   should release (go dim, `false`) before the finger reaches the panel's edge.
5. **Interruption.** Press and hold a panel, then trigger a real system interruption (incoming
   call, notification-shade swipe, app-switch gesture). The panel must end up released, never
   stuck lit, once you return to the page.
6. **No scroll/zoom.** Try to double-tap anywhere on the page, and try to scroll. Neither should
   do anything — the page should feel pinned/app-like, not like a normal webpage.
7. **Keyboard row and log panel** are secondary (a phone has no physical keyboard to test them
   with) — just confirm they render without overlapping the touch panels, per the layout screenshots
   above.

Record the result of each of these seven checks — pass/fail, plus a video or a couple of
screenshots — since that's what turns this from "the page exists" into "touch is actually good on
a phone", which is the whole point per PROJECT.md §2.

## Measured numbers

### poll() cost

| Environment | Method | Result |
|---|---|---|
| Node (vitest, `performance.now()`) | 100,000 calls after a 1,000-call warm-up, boost + thrustRight + one active touch held throughout, no gamepad | **0.18 – 0.26 us/call** across five separate runs of the suite (0.1836, 0.2084, 0.2161, 0.2575, 0.2230 us — reported as a range, not a single cherry-picked number, since repeated runs on shared CI-ish hardware jitter) |
| Real headless Chromium (`/opt/pw-browsers/chromium`, `performance.now()`) | Same methodology, run inside the actual browser against the real bundled module | **0.178 us/call** (100,000 calls) — same order of magnitude as Node, good cross-environment agreement |

### Allocation

Two measurement passes were done; the first was methodologically flawed and is recorded (with the
fix) rather than silently redone, per the "dead ends" note in the log:

1. **Naive attempt** (forcing `gc()` immediately before AND after the loop): showed a 13,956-byte
   delta over 10,000 `poll()` calls. Discarded as inconclusive — forcing GC on both sides only
   measures *retained* growth, which is near-zero for **any** loop whose allocations are fully
   collectable, so it can't actually tell "doesn't allocate" apart from "allocates but nothing
   escapes."
2. **Corrected methodology** (real headless Chromium, launched with `--js-flags=--expose-gc
   --enable-precise-memory-info`): force one clean-baseline `gc()`, run 10,000 calls with **no**
   GC in between (capturing the DevTools-style "sawtooth" peak before it's swept), record
   `performance.memory.usedJSHeapSize`, then `gc()` again to see what's actually retained. Run
   against both `poll()` and a **deliberately allocating control** of the same object shape
   (`() => ({ boost: true, brake: false, thrustX: 1, thrustY: -1 })`) for calibration:

| | Growth before next GC | Per call | Retained after forced GC |
|---|---|---|---|
| Control (fresh object literal every call) | 180,856 B | **18.09 B/call** | 6,724 B (94.5% reclaimed — correctly detected as real, collectable allocation) |
| Real `src.poll()` | 15,112 B | **1.51 B/call** | 14,884 B (almost nothing reclaimed — inconsistent with this being `poll()`-generated garbage; most likely `performance.memory`/CDP measurement overhead itself) |

`poll()`'s measured per-call heap growth is **~12x smaller** than a control that deliberately
allocates one small object per call, and reading the source confirms why: the returned function
contains no `new`, no object/array literal, and no closure allocation on its call path — it writes
four fields onto one pre-allocated `state` object and returns that same reference every time
(verified directly: `expect(a).toBe(b)` for two consecutive `poll()` calls, in the Node suite).
Reported as the measured 1.51 B/call number, not as a bare "zero", per the "numbers not
adjectives" rule — but the calibrated comparison is the actual evidence for the claim.

### Module size (gzipped)

Bundled standalone with esbuild (`--bundle --minify`, ES2022, browser platform), matching T-04
AURORA's methodology for the same kind of measurement:

| Build | Raw | Gzip |
|---|---|---|
| `@swingby/core` externalized (this module's own incremental weight — the fair number, since core is shared across every task that imports it, not duplicated per consumer in the real app bundle) | 3,473 B (3.39 KB) | **1,357 B = 1.325 KB** |
| `@swingby/core` bundled in (worst case; esbuild tree-shaking applied, but not amortized across a larger app the way the real build would) | 3,892 B (3.80 KB) | **1,569 B = 1.532 KB** |

Both numbers are trivial against the project's 250 KB whole-app gzip budget.

### Rebinding / layout independence

Proved with a deliberately mismatched `code`/`key` pair, in both environments:

- Node (fake double): `keyEvent("Space", { key: "e" })` → `boost === true`; and the inverse trap
  — `keyEvent("Digit1", { key: "Space" })` (the `.key` text happens to equal the bound `.code`
  string, `.code` doesn't) → `boost === false`, proving a `.key`-based implementation would have
  been caught by this test.
- Real headless Chromium: `new KeyboardEvent("keydown", { code: "Space", key: "e" })` dispatched
  at a real canvas element → `boost === true` on keydown, `false` on keyup.
- Rebinding: `setBindings({...DEFAULT_CONTROLS, boost: "KeyJ"})` then the **old** code (`"Space"`)
  no longer triggers boost, only `"KeyJ"` does.

### drainEvents() exactly-once semantics

- Single action: one keydown → `drainEvents()` returns `["restart"]` once; calling again returns
  `[]` (drained, not returned twice).
- No loss / no duplication with two actions between polls: `restart` then `pause` dispatched
  before any drain → `drainEvents()` returns `["restart", "pause"]` in order, exactly once each.
- Held-key correctness: one real keydown (`repeat:false`) followed by 500 synthetic OS-repeat
  keydowns (`repeat:true`) → still exactly `["restart"]`, not 501 entries.

### destroy()

- `totalListenerCount()` on the fake element goes from >0 to exactly `0` after `destroy()`.
- A keydown/restart dispatched **after** `destroy()` changes nothing: `poll().boost` stays
  `false`, `drainEvents()` stays `[]` — no stale handler fires.
- 25 repeated create/destroy cycles on the **same** fake element: listener count returns to
  exactly `1` (per relevant type) after each `createInputSource` and exactly `0` after each
  `destroy()`, every cycle — no growth, no leak.
- Confirmed the same way in real Chromium (`destroy()` then a keydown → `drainEvents()` returns
  `[]`).

## Real-browser verification

Beyond the Node vitest suite (the primary, sufficient proof per the task doc: "Use headless
Chromium only if you want an end-to-end check"), I additionally drove the actual bundled
`input.ts` in headless Chromium (`/opt/pw-browsers/chromium`, globally-installed Playwright at
`/opt/node22/lib/node_modules/playwright`) for the things Node cannot simulate at all — no
`window` global, no real `Touch`/`TouchEvent` constructors. Harness (`input-browser-check.cjs`,
`heap-final.cjs`, `input.iife.js`) lives entirely in the scratchpad directory, nothing added to
the repo.

Results, all against the real esbuild-bundled module running in real Chromium:

1. Mismatched `code`/`key` KeyboardEvent → matched on `code` only. ✅
2. Real `window.dispatchEvent(new Event("blur"))` → released a held boost. ✅ (the one assertion
   Node structurally cannot make)
3. Real `new Touch(...)`/`new TouchEvent(...)` (browser context launched with `hasTouch:true`),
   two simultaneous touches in boost + brake zones → both `true`; `touchcancel` for both → both
   `false`. ✅
4. `poll()` cost measured **inside** the browser: 0.178 us/call — agrees with the Node numbers.
5. `destroy()` then a post-destroy keydown → `drainEvents()` empty. ✅
6. Heap growth: see "Allocation" above.

**One real bug was found during this work — in the test harness, not in `input.ts` — worth
recording because it directly validates a design decision.** An early version of the browser
harness captured two separate `poll()` results into two differently-named JS variables inside one
`page.evaluate()` call and returned both. Both came back looking like the touch zones had
silently failed (`{boost:false, brake:false}` for a result captured *before* the release even
happened). Root cause: `poll()` deliberately returns the **same mutable object** every call (the
zero-allocation design); the second `poll()` call mutated the very object the first variable also
pointed to, and Playwright's evaluate-return serialization happens once, at the very end — after
both mutations. Fixed by snapshotting with `{ ...window.__src.poll() }` wherever more than one
result needs to stay alive at once. This is good, first-hand evidence that the "callers must not
retain a `poll()` reference across ticks" caveat (documented in `input.ts`'s own comment and in
the log) is a real trap, not a theoretical one.

## Prove the tests can fail

Temporarily replaced `isHeld`'s binding lookup —

```ts
// before
return code !== UNBOUND && heldCodes.has(code);
// injected bug
return code !== UNBOUND && heldCodes.has(code + "__BROKEN_FOR_FAIL_PROOF__");
```

Ran `npx vitest run packages/web/src/game`:

**Result: 10 failed / 22 passed** (of 32). Every failure was in a test that depends on binding
matching actually working — continuous poll, thrustX/thrustY, drainEvents-vs-poll independence,
layout-independence, rebinding, the rebind-conflict test, both blur tests, and the poll-cost
sanity assertion — exactly the set that should break from a broken lookup, and nothing else (all
touch tests, all destroy tests, and the gamepad tests stayed green, correctly, since they don't
go through `isHeld`/keyboard bindings at all).

Reverted the one-line change immediately after capturing the output. Re-ran: **32/32 passed**,
and `npm run typecheck` clean afterward (confirming the revert was exact, not "passing again by
coincidence").

## Full verification (numbers)

**Historical note:** the fail-proof run above and its "32/32" numbers were captured before the
`touch-zones.ts` split and `input-dev.html` landed, and are kept as-is since that's genuinely what
that run showed at that point in time (append-only, not rewritten — same convention as the log).
The table below is the **current, final state**, re-run after both new files landed and after a
`prettier --write` pass on `touch-zones.ts` and the (now larger) test file:

| Command | Result |
|---|---|
| `npx vitest run packages/web/src/game/__tests__/input.test.ts` | **1 test file, 36/36 tests passed** (my suite in isolation — 32 original + 4 new direct `touch-zones.ts` tests) |
| `npx vitest run packages/web/src/game` (full directory, alongside T-05/T-07's files) | **2 test files, 70/70 tests passed** (my 36 + T-07 CHORUS's 34 `audio.test.ts` — confirms nothing of mine broke their suite, and nothing of theirs broke mine) |
| `npm run typecheck` (contracted root script, `tsc --build --force`) | Clean — no output, exit 0 |
| `npm test` (whole repo) | **18 test files passed, 432 passed + 1 skipped (433 total)** — all green, including every other task's suite (the 1 skip is T-01 KEPLER's pre-existing Godot-parity gate, not mine) |
| `npx prettier --check packages/web/src/game/input.ts packages/web/src/game/touch-zones.ts packages/web/src/game/__tests__/input.test.ts` | Passes after one `--write` pass on `touch-zones.ts` and the test file to match project formatting (whitespace only, no logic change; `input.ts` was already clean from the previous session) |
| `input-dev.html` served by `npm run dev -w @swingby/web` and driven with real headless-Chromium `Touch`/`TouchEvent`/`KeyboardEvent` dispatch | All checks passed — see "The input-dev.html page and the real-phone check" above for the full table |

## What could not be verified (honesty section, as required)

- **Real phone — BLOCKED, host-only.** No physical device is reachable from this environment. This
  is explicitly flagged in the task doc as "the single most likely thing to make the web version
  feel bad, and it cannot be judged on desktop" — still true here. `input-dev.html` now exists and
  is confirmed working end-to-end in headless Chromium's `hasTouch:true` context with real
  `Touch`/`TouchEvent` constructors (see "The input-dev.html page and the real-phone check"
  above), which exercises the same DOM event path a phone would drive — but that is a
  same-machine, same-JS-engine proxy, not a phone. It cannot verify actual touch latency, palm
  rejection, on-screen-keyboard interaction, or how the panels feel at real finger size/pressure on
  real glass, held one-handed. The exact URL and a seven-point checklist for a human with a phone
  are written out above; this line item stays unchecked in the Definition-of-done table until that
  happens, on purpose.
- **Real gamepad hardware.** No physical controller is attachable to this container. Verified
  instead: (a) the exact button-index mapping against the Godot reference source
  (`PhysicsEngine.gd:105-106`), (b) the mapping logic against a **mocked**
  `navigator.getGamepads()` returning hand-built button-state objects, in both the "nothing
  connected" and "pad connected" cases, (c) the call-count optimization (`navigator.getGamepads()`
  called once at construction when disconnected, once per `poll()` when connected) via a spy.
  **Not verified:** real per-browser Gamepad API quirks (stale/duplicate `Gamepad` object
  references some browsers return, axis noise/deadzones — not applicable here since only buttons
  are used, connect/disconnect timing races with a real device, or wireless-controller input
  latency).
- **`window` blur in the Node unit suite.** Node has no `window` global at all, so the primary
  vitest suite necessarily tests the release logic via `target`-level blur instead (documented
  inline). This gap is closed by the real-headless-Chromium check above, which does dispatch a
  genuine `window` `blur` event — but that's this task's own supplementary verification, not part
  of the required, environment-portable `npm test` run.
- **DevTools' actual "Memory" panel / allocation timeline UI.** The task doc's literal instruction
  ("DevTools → Memory, 10,000 `poll()` calls, no allocation sawtooth") describes a manual,
  visual inspection of Chrome's Memory panel, which requires a GUI browser session this headless
  environment does not have. Substituted with the programmatic equivalent — the same underlying
  `performance.memory` API DevTools itself reads from, driven via CDP through Playwright, with a
  calibrated allocating control for comparison (see "Allocation" above) — but this is not the same
  as a human looking at an actual sawtooth graph.

## Files

- `packages/web/src/game/input.ts` — `InputSource` interface, `createInputSource()` (382 lines)
- `packages/web/src/game/touch-zones.ts` — `TouchZones`, `pointInRect`, `classifyPoint` (34 lines)
- `packages/web/src/game/input-dev.html` — standalone dev/verification page, deliverable 4 (316
  lines) — the exact URL and phone checklist are above, under "The input-dev.html page and the
  real-phone check"
- `packages/web/src/game/__tests__/input.test.ts` — 36 tests (590 lines) — path divergence from
  the task doc's `packages/web/test/input.test.ts`, explicitly approved by the coordinator
- `notes/T-06-HELM/log.md` — working log (reference citations, decisions and why, the harness bug,
  the touch-zones split, the input-dev.html build and its layout-overlap fix, all measured numbers
  as they were taken)
