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
- [ ] **Verified on a real phone, not an emulator or a narrow desktop window** — not possible in
  this environment (no physical device, no way to attach one to a headless container). Substituted
  with headless-Chromium multi-touch (`hasTouch:true` context, real `Touch`/`TouchEvent`
  constructors) as the closest available proxy — see "What could not be verified".
- [x] No dependency on `loop.ts`, `render/`, or `ui/` — `input.ts`'s only import is
  `type { ControlAction, InputState }` and `DEFAULT_CONTROLS` from `@swingby/core`; grepped the
  file to confirm no other import exists.
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

| Command | Result |
|---|---|
| `npx vitest run packages/web/src/game` | **1 test file, 32/32 tests passed** (my suite in isolation) |
| `npx vitest run packages/web/src/game` (full directory, after T-05/T-07 landed alongside) | **2 test files, 66/66 tests passed** (my 32 + T-07 CHORUS's 34 `audio.test.ts` — confirms nothing of mine broke their suite, and nothing of theirs broke mine) |
| `npm run typecheck` (contracted root script, `tsc --build --force`) | Clean — no output, exit 0 |
| `npm test` (whole repo) | **18 test files passed, 428 passed + 1 skipped (429 total)** — all green, including every other task's suite (the 1 skip is T-01 KEPLER's pre-existing Godot-parity gate, not mine) |
| `npx prettier --check packages/web/src/game/input.ts packages/web/src/game/__tests__/input.test.ts` | Passes after one `--write` pass to match project formatting (whitespace only, no logic change) |

## What could not be verified (honesty section, as required)

- **Real phone.** No physical device is reachable from this environment. This is explicitly
  flagged in the task doc as "the single most likely thing to make the web version feel bad, and
  it cannot be judged on desktop" — still true here. Substituted with headless Chromium's
  `hasTouch:true` context and real `Touch`/`TouchEvent` constructors (see above), which exercises
  the same DOM event path a phone would drive, but cannot verify actual touch latency, palm
  rejection, on-screen-keyboard interaction, or how the zones feel at real finger size/pressure on
  real glass. `attachTouch`'s zone rects are also caller-supplied (T-08 BRIDGE's layout, not yet
  built) — the zone *sizing/placement* for a real thumb has not been evaluated at all, only the
  hit-testing logic given arbitrary rects.
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

- `packages/web/src/game/input.ts` — `InputSource` interface, `createInputSource()` (390 lines)
- `packages/web/src/game/__tests__/input.test.ts` — 32 tests (548 lines)
- `notes/T-06-HELM/log.md` — working log (reference citations, decisions and why, the harness bug,
  all measured numbers as they were taken)
