# T-07 CHORUS — thought log

## 2026-08-13T16:11Z — research done, about to write audio.ts

Read in order: README.md, PROJECT.md, INTERFACES.md, tasks/T-07-CHORUS.md, then
`reference/swift/AudioManager.swift` (full, 227 lines — the ONE file in `reference/swift/` that is
actually the reference), `reference/godot/scripts/AudioManager.gd` (full, ~215 lines, for trigger
timing only, not synthesis), then frozen `packages/core/src/types.ts` and `constants.ts` (no
audio-related constants there — confirmed CHORUS is standalone), then `notes/README.md` and skimmed
`notes/T-06-HELM/log.md` and `notes/T-04-AURORA/log.md` for environment gotchas.

### Session hard-rule vs task-doc conflict — resolved in favour of session rules (same call T-06 made)

`tasks/T-07-CHORUS.md` "Owned files" lists `audio.ts`, `audio-voices.ts`, and a dev page
`audio-dev.html`, and Deliverable #3 asks for that dev page. The orchestrator's session-level hard
rule 1 says: "Write only `packages/web/src/game/audio.ts` and your tests... Touch only `audio.ts`
and your own test file. Nothing else anywhere." INTERFACES.md's file-ownership table (the actually
frozen contract, §"File ownership") lists only `packages/web/src/game/audio.ts` for T-07 — it does
NOT mention `audio-voices.ts` or `audio-dev.html`, so the task doc's file list is not itself part of
the frozen contract and the session rule does not conflict with INTERFACES.md, only with the task
doc's elaboration. Per the standing instruction that messages from the launching agent direct my
work, and consistent with T-06 HELM's identical resolution (see `notes/T-06-HELM/log.md`, "Session
hard-rule vs task-doc conflict"): **decision — fold all voice-synthesis code into `audio.ts` itself
(no separate `audio-voices.ts`), and do not create `audio-dev.html` in the repo.** Test file at
`packages/web/src/game/__tests__/audio.test.ts` (matches the existing `__tests__/` convention
already on disk next to T-06's `input.test.ts`). For manual/browser verification I'll build an
equivalent harness in the scratchpad directory only (outside the repo, not a deliverable), and note
in `results/T-07-CHORUS.md` that the repo-committed dev page was intentionally not created, same as
T-06 did for its input-dev.html.

### What I take from AudioManager.swift, file:line, and what I deliberately don't

- `AudioManager.swift:19` ambient drone: pure 60 Hz sine, constant gain 0.04, always running once
  the engine starts. No public toggle for it anywhere in the file (the ambient node is attached and
  started in `setup()` and never stopped except in dealloc, which isn't in the excerpt). **Port
  decision:** our frozen `AudioSink` has no "level start / level end" method distinct from
  `chime("levelStart")` — one `AudioSink` is created once (probably at app start, per
  `createSession(opts: {..., audio: AudioSink, ...})` in INTERFACES.md, meaning one sink outlives
  many levels). So I'm making the ambient drone start as soon as the underlying `AudioContext` is
  first constructed (i.e. on first real use) and run continuously until `destroy()`, gated only by
  the mute master gain — matching Swift's "always on once engine exists" behaviour without needing a
  method the interface doesn't have.
- `AudioManager.swift:85-105` boost/brake: sine oscillators at 220 Hz / 140 Hz, target gain 0.25 when
  active else 0, smoothed **per-sample** with `gain += (target - gain) * ramp`, `ramp = 0.0005` at
  `sampleRate = 44100`. That per-sample IIR is exactly what WebAudio's `AudioParam.setTargetAtTime`
  computes in continuous time, so the port is a straight translation, not a reinterpretation. Solved
  for the equivalent time constant: a per-sample multiplicative decay of `(1-ramp)` at sample period
  `1/44100 s` corresponds to `tau = -(1/44100) / ln(1-ramp)`. For `ramp=0.0005`: `ln(0.9995) ≈
  -0.00050013`, `tau ≈ 0.045341 s` (45.34 ms). Using `tau = 0.045` in `setTargetAtTime`. Same
  derivation for the alarm's `ramp=0.001` at `AudioManager.swift:108`: `ln(0.999) ≈ -0.0010005`,
  `tau ≈ 0.022665 s` (22.67 ms) → using `0.023`.
- `AudioManager.swift:107-119` alarm: sine at 680 Hz, amplitude tremolo via a 3 Hz LFO
  (`(sin(lfo)+1)*0.5`, i.e. full-depth 0↔1 tremolo), `alarmTargetGain = proximity * 0.3`. Frequency
  is FIXED at 680 Hz in Swift — proximity only scales gain, not pitch. But the task doc's own Voices
  table (`tasks/T-07-CHORUS.md` "Alarm" row) explicitly asks for "Rises in pitch and volume as bounds
  approach", which Swift does not do. **Deliberate deviation, flagged:** I'm adding a pitch rise
  (500→900 Hz linear in intensity) on top of Swift's gain/tremolo model, keeping the tremolo rate
  fixed at Swift's 3 Hz (not scaling that too — one deviation from spec is enough, don't invent a
  second parameter Swift never had and the task doc never asked for).
- `AudioManager.swift:155-184` `playChime(frequency:duration:)`: linear-decay envelope
  (`env = 1 - i/totalFrames`), amplitude scale 0.3, one-shot `AVAudioPlayerNode` per call, detached
  in a completion callback. WebAudio equivalent: a transient `OscillatorNode`+`GainNode` pair,
  started and stopped once, disconnected `onended`. This is the ONE place per-event node
  allocation is correct rather than a leak — `AudioManager.swift` itself does exactly this (attaches
  a fresh `AVAudioPlayerNode` per chime, detaches on completion) — chimes are rare, discrete events
  (level start once, goal once, reset occasional, click occasional), not the 144 Hz-driven
  continuous voices the "never start/stop per event" constraint is actually about.
- `AudioManager.swift:186-196` `playLevelStart` (880 Hz, 0.15 s) and `playGoalReached` (523/659/784 Hz
  triad — C5 E5 G5 — 0.12 s each, staggered 0.14 s apart via `asyncAfter`) ported directly as chime
  parameter tables. WebAudio equivalent of the `asyncAfter` stagger: schedule all three oscillators
  up front against `ctx.currentTime + offset` rather than three real `setTimeout`s — more accurate
  (sample-scheduled, not event-loop-jittered) and doesn't need cleanup timers.
- `AudioManager.swift:198-222` `playAutoReset` (0.4 s, linear frequency sweep 300→150 Hz, constant
  amplitude 0.25, **no fade-out** — the buffer just ends). Ported the sweep via `linearRampToValueAtTime`
  on `frequency`, but I AM adding a short fade-out (last ~30 ms) that Swift's version lacks — Swift
  gets away with a hard stop because it's a fixed-length rendered buffer ending exactly at its own
  boundary (no discontinuity thereafter, node just stops), but our persistent-graph, ramped-only
  discipline (constraint 3 in the task doc) argues for a decay-to-zero close even on a one-shot, and
  it's free. Flagged as a deliberate addition.
- `AudioManager.swift:224-226` `playUITap` = `playChime(1200, 0.03)`, ported as `"click"` with the
  same numbers.
- **What I did NOT take:** `AudioManager.gd`'s actual `.wav` files (obviously — that's the licensing
  problem CHORUS exists to remove) and its noise-based `_make_rocket_sound()` (filtered-noise boost
  texture) — Swift's boost is a plain sine, and Swift is the explicit reference for T-07, not Godot;
  Godot's richer 3-band-noise engine sound and click transient (`_make_click_sound`, three sine
  components + `exp` decay) were read for trigger-timing context only, per the task doc's own framing
  ("the trigger logic is worth reading even though the samples are not").

### Dead end already ruled out

Considered giving `brake` the same 220↔140 sine treatment as `boost` (pure port, zero deviation).
Rejected: the task doc's own Voices table calls brake "Lower, rougher sustained tone" — pure sine at
a lower frequency isn't "rougher," it's just lower. Cheapest way to add roughness without a second
oscillator or noise buffer: change `OscillatorType` from `"sine"` to `"sawtooth"` for the brake voice
only. Zero extra nodes, zero extra allocation, satisfies the spec's own adjective. Documented here so
a reviewer doesn't mistake it for an unexplained divergence from Swift.

### Alarm tremolo — WebAudio implementation choice

Swift computes the tremolo per-sample in its own render callback (`(sin(lfo)+1)*0.5`, multiplied
into the tone sample directly) — there's no direct WebAudio equivalent to "multiply this oscillator's
output by another oscillator's output" without either a `ScriptProcessorNode`/`AudioWorklet` (extra
complexity, and worklets need a separate module file to load — awkward for a single-file, no-new-file
constraint) or ring modulation via `GainNode.gain` **additive** AudioParam modulation. Chose the
latter: connect a second oscillator (3 Hz sine) through a scaling `GainNode` directly into the
target gain's `.gain` AudioParam (AudioParam inputs sum with the param's own scheduled value). Set
the alarm's own gain param to `target*0.5` (half of the desired peak) and the LFO scaler's gain to
the same `target*0.5` — sum ranges `[0, target]` as the LFO swings ±0.5, exactly reproducing Swift's
`envelope * (sin+1)/2 = envelope*0.5 + envelope*0.5*sin` algebra. Both the alarm gain and the LFO
scaler track alarm intensity, so two `setTargetAtTime` calls per `setAlarm()` invocation, no new
nodes ever, matches the "cheap and idempotent" constraint.

### Master bus / clipping — one addition beyond Swift

Swift's `masterMixer` is a plain `AVAudioMixerNode` with no limiter; worst case (boost 0.25 + brake
0.25 + alarm 0.3 + a chime peak 0.3 all overlapping) sums to ~1.1, which would clip a plain sum in
WebAudio too. Adding a `DynamicsCompressorNode` between the master gain and `ctx.destination` — a
built-in WebAudio node, no dependency, negligible cost, standard safety net for additive synthesis.
Not present in Swift; a deliberate small addition, flagged.

### Lazy construction — exact trigger chosen

`createAudio()` builds a closure with `engine: Engine | null = null` and never touches
`AudioContext`. The context is constructed by an internal `ensureEngine()` called from
`setBoost`/`setBrake`/`setAlarm`/`chime` (the four methods that actually want to produce sound) but
**not** from `setMuted` — `setMuted` only needs to work as a pure state setter (storage's settings
patch can call it at app boot, long before any gesture, e.g. applying a persisted "muted: true"), so
forcing construction there would reintroduce exactly the autoplay-policy bug this task exists to
avoid. `setMuted` before construction just remembers the flag in the closure and applies it
(via `setValueAtTime`, not a ramp — nothing is audible yet at construction time so there's no click
to avoid) the moment the engine is eventually built.

### Test double plan

No jsdom, no `web-audio-test-api` (forbidden). Writing a small `FakeAudioContext` /
`FakeOscillatorNode` / `FakeGainNode` / `FakeAudioParam` / `FakeDynamicsCompressorNode` inline in
`__tests__/audio.test.ts` itself (no second test-helper file, per the strict "only audio.ts and your
test file" rule — T-10 VAULT's `fake-local-storage.ts` helper file is NOT a pattern I can copy here).
Installed onto `globalThis.AudioContext` per-test (mirrors how the storage tests swap
`globalThis.localStorage`, see `packages/web/src/storage/__tests__/storage.test.ts:27-37`).
`FakeAudioParam` records every automation call (`setValueAtTime`/`linearRampToValueAtTime`/
`setTargetAtTime`) into a list AND counts direct `.value =` assignments separately, so a test can
assert "every GainNode.gain across the whole graph has `directSetCount === 0`" — a global,
order-independent proof that gains are always ramped, never assigned (constraint 3 / DoD "no clicks
or pops"). `FakeOscillatorNode.stop()` synchronously fires its own `onended` (real WebAudio fires it
asynchronously once playback actually ends; the fake has no real clock, so firing synchronously on
`stop()` is the documented simplification — it still proves the cleanup handler runs and disconnects
the transient chime nodes, which is the thing under test).

### Next step

About to write `packages/web/src/game/audio.ts`, then the test file, then run
`npx vitest run packages/web/src/game`, `npm run typecheck`, a gzip-size measurement of the module
alone, and the break-it-to-prove-it-can-fail pass. Will log again before anything slow (the
typecheck run touches the whole repo including two other agents' in-flight files) and again with the
actual measured numbers.

## 2026-08-13T16:23Z — implementation + verification complete, all numbers measured

Wrote `packages/web/src/game/audio.ts` (single file, per the resolved conflict above — no separate
`audio-voices.ts`) and `packages/web/src/game/__tests__/audio.test.ts` with an inline
`FakeAudioContext`/`FakeOscillatorNode`/`FakeGainNode`/`FakeAudioParam` double (no `audio-voices.ts`,
no `audio-dev.html`, no new test-helper file — everything in the one test file, per hard rule 1).

### One test-design correction made while writing, worth recording

First draft of `FakeOscillatorNode.stop()` fired `onended` synchronously, to make "chime cleaned up
after playback" observable without a real clock. Realized this made it *impossible* to write a
genuine test for `destroy()`'s own `activeChimes` sweep (`teardown()`'s loop that stops/disconnects
any chime still in flight) — since the fake always self-cleaned before `destroy()` could ever see a
non-empty set, that whole code path was untested by construction. **Fix:** split `stop()` (records
the stop, matches real WebAudio's synchronous scheduling call) from a new `triggerEnded()` method
tests call explicitly to simulate the real, asynchronous `ended` event. This let me write a test
that calls `chime("goal")`, asserts the three transient oscillators are still connected (genuinely
"in flight", `ended` never fired), calls `destroy()`, and asserts `teardown()` itself is what
disconnects them. Recording this because it's the kind of test-fidelity bug that would otherwise
sit undetected — the original version of the suite was green but was not actually exercising the
line it claimed to.

### Verification run — all commands actually executed, numbers below

1. `npx vitest run packages/web/src/game/__tests__/audio.test.ts` → **34 passed, 0 failed.**
2. `npm run typecheck` (whole repo, `tsc --build --force`) → **0 errors anywhere**, including
   `packages/web/src/game/audio.ts` and its test file. (Repo-wide, not just my files — the other two
   agents' in-flight files were also clean at this snapshot; not my concern either way per the
   session rules, just noting it since a `--force` full-repo build was the only way to check my own
   files with the shared `tsc --build`.)
3. `npx vitest run` (whole repo) → **428 passed, 1 skipped, 0 failed, 18 test files** — confirms
   nothing outside `audio.ts`/`audio.test.ts` was touched or broken.
4. `npx prettier --check` on both my files → failed on first run (whitespace-only issues from my own
   formatting judgment calls, e.g. one array literal esbuild/prettier wanted multi-line), fixed with
   `--write`, re-checked clean. Re-ran vitest + typecheck after the reformat to confirm the
   auto-formatting didn't change behaviour — still 34/34 and 0 errors.
5. Module size, standalone (esbuild bundle+minify, since nothing imports `game/` into `main.ts` yet —
   T-05 FLYWHEEL hasn't wired it in, so a whole-app `npm run build` wouldn't include it at all,
   confirmed: whole-app build is 1.56 KB gzip total right now, all launchpad scaffold, zero audio
   code tree-shaken in). `npx esbuild audio.ts --bundle --minify --format=esm --target=es2022`:
   **3,452 bytes minified, 1,303 bytes gzip (gzip -9)** = **1.27 KB**, i.e. **0.51% of the 250 KB
   whole-app budget.** Confirmed via `npm run build -w @swingby/web` + `find dist -iname "*.wav" -o
   -iname "*.mp3" -o -iname "*.ogg"` → empty, and `npm run size` → PASS, 1.56 KB / 250 KB (unrelated
   to my module specifically, since it isn't wired in yet, but proves the mechanical check itself
   works and that nothing of mine could be shipping a binary asset by accident).
6. **Prove tests can fail**, two separate breaks, both reverted after:
   - Broke lazy construction (added an eager `buildEngine(new Ctor())` call inside `createAudio()`
     itself) → **5 failed, 29 passed** (the lazy-construction describe block, correctly, all went
     red — 4 of its 5 "constructs no context yet" assertions, plus the "muted flag applied at
     construction" test which now saw the wrong first automation event since the context existed
     before `setMuted` even ran).
   - Reverted, confirmed 34/34 green again.
   - Broke the ramp discipline (`e.boost.gain.gain.value = active ? BOOST_GAIN : 0` instead of
     `setTargetAtTime`) → **1 failed, 33 passed** — exactly the "rapid boost toggling... never
     assigns .gain.value directly" test, reporting `directSetCount` 100 instead of the expected 0 (it
     ran 100 toggles in the loop, all 100 were direct assignments — the assertion failure message
     itself reports the number).
   - Reverted, confirmed 34/34 green again, typecheck still 0 errors, whole-repo suite still
     428/1/0.
7. **Real-browser end-to-end check**, headless Chromium (no `playwright` npm package installed in
   this environment, only the raw binary at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` —
   drove it directly via CLI flags + `--dump-dom`, no CDP client needed for this since the harness
   page writes its own results into the DOM and `document.title`). Chromium **141.0.7390.37**.
   Harness at `<scratchpad>/size/harness.html` (NOT in the repo — scratchpad only, per the "only
   audio.ts and the test file" rule) wraps the real `AudioContext` constructor and `.close()` in
   counting shims *before* loading an esbuild IIFE bundle of `audio.ts`, exercises the same sequence
   as the vitest suite, and writes a JSON summary into the DOM, dumped via `--dump-dom
   --virtual-time-budget=4000`. Ran with `--autoplay-policy=no-user-gesture-required` — flagging
   this explicitly as a limitation: that flag is what let `resume()` actually reach `"running"`
   without a real synthetic pointer/key event, since there is no display/input surface in this
   container to generate one. It proves the code *calls* `resume()` correctly and never throws
   against a **real** `AudioContext` (as opposed to the hand-written fake), but it does NOT prove
   the browser's actual gesture-blocking behaviour end-to-end — that needs a human tester in a real
   window, see results file. Measured, in real Chromium:
   - `createAudio()` alone: **0** real `AudioContext` instances constructed.
   - `setMuted(true); setMuted(false)` alone (no real use yet): still **0**.
   - First `setBoost(true)`: **1** constructed, state transitions to `"running"`.
   - `setBrake`/`setAlarm`/all 4 `chime()` kinds/200× rapid `setBoost` toggle/200× `setAlarm` sweep
     on the SAME sink: construct count stays **1** — engine reused, never rebuilt, no throw.
   - `destroy()` → context state **"closed"** (after awaiting the real async close).
   - 20 create/use/destroy cycles: **21** total contexts constructed (1 + 20), **21** `.close()`
     calls, **all 21** end in `"closed"` state, **0** uncaught errors anywhere in the whole run.
   - `AudioContext` deleted entirely from `window` (simulating a browser with no WebAudio support at
     all): every method silent no-op, no throw.

### Current state — essentially done

`audio.ts` and its test file are complete and green (34/34, 0 typecheck errors, repo-wide suite
unaffected). Both the node-side fake-double proof and an independent real-Chromium proof agree.
Remaining work: write `results/T-07-CHORUS.md` with the full parameter table and DoD checklist, then
final report to the orchestrator. The one thing genuinely NOT verifiable in this container, stated
plainly rather than glossed over: **nobody here can listen to the output.** All the envelope shapes,
frequencies, and gain levels are checked as numbers against the fake's recorded automation calls and
(for construction/lifecycle only, not perceptual quality) against a real AudioContext in headless
Chromium — but whether the alarm's pitch-rise actually reads as urgent, whether the sawtooth brake
sounds "rougher" rather than just "worse," whether the goal fanfare's timing feels good — none of
that has been heard by anyone, human or otherwise, and won't be until a human opens
`packages/web/src/game/audio-dev.html`-equivalent (not built, per the file-ownership decision above)
or the real game (once T-05 wires `createAudio()` in) in a real browser with speakers.

## 2026-08-15T04:43Z — session restarted (usage limit), ownership widened, deliverables 2+3 landed

Container restarted between the previous entry and this one (usage limit, per the coordinator).
Verified on resume: `audio.ts` and the 34-test suite both survived on disk untouched, matching the
content this log already described. The coordinator's message (both before and after the restart,
consistently) widened T-07's ownership: the "nothing else anywhere" session rule was the
coordinator's own overly-strict rule, not INTERFACES.md, and it's now relaxed to match the task doc.
Two more paths are mine: `packages/web/src/game/audio-voices.ts` and
`packages/web/src/game/audio-dev.html`. `input.ts`/`touch-zones.ts` (T-06, live) and `render/**`
(T-04, live) remain explicitly off-limits — unchanged, still not touched.

### The split — mechanics, not redesign

Moved everything under "Synthesis parameters" and "Engine" (all constants, `ChimeTone`/`ChimeKind`/
`Voice`/`AlarmVoice`/`ChimeVoice`/`Engine` types, `makeVoice`, `buildEngine`, `stopAndDisconnect`,
`teardown`→renamed `teardownEngine`, `playChime`) into `audio-voices.ts`, verbatim — not one number
changed. Added four small control functions there too (`setBoostVoice`, `setBrakeVoice`,
`setAlarmVoice`, `setMasterMuted`) that are literally the old inline bodies of the `AudioSink`
methods, lifted out unchanged and given names — this is what makes `audio.ts` legitimately "the
public surface, nothing else": every method is now `const e = ensureEngine(); if (!e) return;
xVoice(e, ...)`, three lines, no synthesis numbers left in the file at all. `resolveAudioContextCtor`
and the lazy-construction closure (`ensureEngine`, the `engine`/`muted`/`destroyed` state, the
visibility-change wiring) stayed in `audio.ts` — that's the "WHEN", not the "HOW", and is the actual
contract this task is graded on (autoplay policy).

Verified behaviour-preserving the direct way: **no changes to `__tests__/audio.test.ts` at all** —
it only ever exercised the public `AudioSink` surface through the fake `AudioContext`, never
imported anything from inside `audio.ts`, so if the split changed observable behaviour the existing
34 tests would be the ones to catch it. They didn't move and they all still pass:
`npx vitest run packages/web/src/game/__tests__/audio.test.ts` → **34/34**, unchanged from before
the split. `npm run typecheck` → 0 errors. `npx vitest run` (whole repo) → **432 passed, 1 skipped**
(matches the coordinator's stated post-restart baseline exactly, confirming nothing else regressed).
Module size after the split (esbuild bundle of `audio.ts`, which now pulls in `audio-voices.ts`
too, minified+gzip): **1,315 bytes gzip** (was 1,303 before the split — the ~12-byte difference is
just per-module export/import boilerplate once bundled, not a real cost). Still 0.51% of the 250 KB
budget.

### The dev page — real end-to-end verification, not just "it typechecks"

Built `audio-dev.html` per the coordinator's spec: Start button (also fires `chime("levelStart")` as
the first real gesture), press-and-hold Boost/Brake buttons via Pointer Events (mouse+touch unified,
with `pointerup`/`pointerleave`/`pointercancel` all releasing — same stuck-input discipline T-06
HELM used for its touch zones, cited in my earlier research notes above), a mute toggle, an alarm
intensity slider whose readout shows the live computed frequency/gain next to the slider (so a
listener can connect what they hear to a number, per the coordinator's explicit ask), four chime
buttons, a live event log, and the full parameter reference table (same numbers as this log/results,
transcribed once more so a phone tester doesn't need the repo open) plus the six listener questions,
deviations listed first. Not wired into the production build — confirmed via
`npm run build -w @swingby/web` + `find dist -iname "*audio-dev*" -o -iname "*audio-voices*"` →
empty, since nothing in `index.html`'s module graph references it.

**Actually drove it in a real browser**, not just eyeballed the HTML. No `playwright` npm package in
this environment (same gap as before), so I went one level lower than the previous session's
`--dump-dom` trick: launched headless Chromium with `--remote-debugging-port=9222` and spoke raw
Chrome DevTools Protocol over a plain `WebSocket` from Node (Node 22 ships a global `WebSocket` and
`fetch`, no dependency needed) — `Page.navigate` to the real `http://localhost:5173/src/game/
audio-dev.html` served by a real `npm run dev -w @swingby/web`, `Emulation.setDeviceMetricsOverride`
to an iPhone-sized 390×844 viewport, then genuine `Input.dispatchMouseEvent` press/release pairs at
each button's real `getBoundingClientRect()` center — not a scripted `.click()` call, an actual
synthesized pointer event the same as a real tap would produce.

**One real bug this caught in my own test methodology, not the page**: first pass, 3 of 4 chime
clicks silently did nothing (log only grew by 1 entry instead of 4). Diagnosed by printing each
button's bounding rect: `cy` was 904–962 against a 900px-tall viewport — the click coordinates were
below the fold. Not a page defect (it's a normal 8-section scrolling page; a human thumb just
scrolls) — my driver script wasn't scrolling before clicking. Fixed by calling `scrollIntoView({
block: "center" })` before computing each click target's rect, exactly what a real user's scroll
gesture accomplishes. Documenting this because it's a small methodology trap worth flagging for
whoever writes the next headless-CDP harness: **a coordinate-based click against an un-scrolled
long page fails silently — no error, no exception, just nothing happens** — easy to misread as "the
button doesn't work" when it's "the click never landed on it."

Measured, real Chromium, real phone viewport, real clicks, after the fix — every single interaction
path exercised once (Start → Boost hold/release → Brake hold/release → Alarm slider to 70% → all 4
chimes → Mute → Unmute):
- `viewport`: 390×844 (confirms the page actually renders at a phone size, not just claims to)
- Tapping Start: status text flips to `"AudioContext constructed and running."`, `.ok` class applied
- Boost held 300 ms then released: `.held` class correctly removed after release (not stuck)
- Alarm slider set to 70 (via `.value` + a dispatched `input` event — the same path assistive tech
  uses, more honest than trying to drag a `<input type=range>` by pixel coordinates in headless):
  readout `"70%"`, computed frequency `"780"` (500 + 0.7×400 = 780 ✓ matches the formula in
  `audio-voices.ts` exactly), computed gain `"0.210"` (0.7×0.3 = 0.21 ✓)
- Mute toggle: `.active` class applied, label flips to `"Unmute"`, then correctly reverts on a
  second click
- Event log: exactly 12 entries (1 static placeholder + 11 real log lines: start's own chime +
  boost×2 + brake×2 + all 4 chimes + mute×2), in the correct chronological order, newest-first
- Console messages: only Vite's own HMR-websocket debug lines (`[vite] connecting...` /
  `connected.`) — **zero application errors, zero uncaught exceptions**, both before and after the
  prettier reformat pass (re-ran the identical drive script after `prettier --write`, byte-identical
  results, confirms formatting didn't change behaviour)

### Current state

Both new files exist, are typechecked clean, are prettier-clean, and are proven to work end-to-end in
a real browser at a real phone viewport size with real dispatched input events — not merely "the
code parses." The `AudioSink` behavioural test suite (34 tests) is unchanged and still green,
confirming the extraction didn't alter anything observable. Next: update `results/T-07-CHORUS.md` —
flip deliverables 2 and 3 to landed, add the dev-server URL and the listener-question list (already
drafted, in the page itself, and duplicated into results per the coordinator's ask), keep deliverable
4 BLOCKED (still host-only — headless Chromium proves the code doesn't throw and wires correctly, it
cannot prove a human would call the sawtooth brake "rougher" rather than "buzzy," and Firefox/Safari/
iOS Safari remain physically unreachable from this container), and leave the "what could not be
verified" section exactly as originally written since the coordinator asked for it not to be
softened and it is still accurate — no listening has actually happened, only real-browser mechanical
proof.
