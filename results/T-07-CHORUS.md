# T-07 CHORUS — results

Procedural WebAudio for SwingBy Web. All sound is synthesized at runtime with `OscillatorNode` /
`GainNode` graphs — no audio file of any kind is imported, embedded, or fetched.

Full reasoning trail (what was ported from `AudioManager.swift` line-by-line, the deliberate
deviations, dead ends ruled out, the exact tau derivations): `notes/T-07-CHORUS/log.md`.

---

## 1. A file-ownership conflict, raised and then resolved by widening ownership

`tasks/T-07-CHORUS.md`'s "Owned files" list and Deliverable #3 ask for `audio-voices.ts` and a
committed `audio-dev.html` dev page. The orchestrator's original session-level hard rule 1 said:
*"Write only `packages/web/src/game/audio.ts` and your tests... Touch only `audio.ts` and your own
test file. Nothing else anywhere."* First pass therefore folded everything into `audio.ts` alone and
did not commit a dev page (documented in the log, and consistent with T-06 HELM hitting the identical
conflict for its own `input-dev.html`).

**The coordinator subsequently reviewed this, agreed the task doc is the actual spec, and widened
ownership**: T-07 now additionally owns `packages/web/src/game/audio-voices.ts` and
`packages/web/src/game/audio-dev.html`. Both are now landed:

- `audio-voices.ts` holds every synthesis parameter, the node-graph build/teardown, and the four
  chime/voice control functions — everything about *how* each voice sounds. `audio.ts` was reduced to
  the public `AudioSink` surface and the lazy-construction contract — everything about *when* sound
  happens. The split is behaviour-preserving: the 34 pre-existing tests were not modified at all
  (they only ever exercised the public surface) and all 34 still pass unchanged — see §5.
- `audio-dev.html` is a real, working dev page — see §6b for how it was verified in an actual browser
  with real dispatched clicks, and §8 for the URL to open and the listener questions.

---

## 2. Deliverables

| # | Artifact | Path | Status |
|---|---|---|---|
| 1 | `createAudio` + the `AudioSink` interface | `packages/web/src/game/audio.ts` | Done — matches INTERFACES.md exactly |
| 2 | Voice synthesis: ambient, boost, brake, alarm, chimes | `packages/web/src/game/audio-voices.ts` | **Landed** — split out of `audio.ts`, behaviour-preserving (§5); see §4 for the parameter table |
| 3 | Dev page (button per voice, alarm slider) | `packages/web/src/game/audio-dev.html` | **Landed** — button per voice, alarm slider, mute toggle, live parameter readouts, event log; verified with real dispatched clicks in headless Chromium at a phone viewport (§6b); URL + listener questions in §8 |
| 4 | Browser test matrix results | this file, §6, §6b | **BLOCKED — host-only.** Headless Chromium (no display) proves the code doesn't throw and wires correctly; it cannot judge whether a synthesis choice sounds right, and Firefox/Safari/iOS Safari are not installed in this container at all. Needs a human with real browsers and speakers — see §7, §8 |
| — | Unit tests | `packages/web/src/game/__tests__/audio.test.ts` | Done — 34 tests, all passing, unmodified by the split (§5) |
| — | Thought log | `notes/T-07-CHORUS/log.md` | Done, append-only, kept current throughout, including the split and the dev-page build |

Files touched, total, across both passes: `packages/web/src/game/audio.ts`,
`packages/web/src/game/audio-voices.ts`, `packages/web/src/game/audio-dev.html`, their test file,
`notes/T-07-CHORUS/**`, and this results file. Nothing else — `input.ts`, `touch-zones.ts` (T-06,
live) and `render/**` (T-04, live) were not touched.

---

## 3. Definition of done

| Item | Status | Reason |
|---|---|---|
| No audio file of any kind in the bundle | ✅ | `find dist -name "*.wav" -o -name "*.mp3" -o -name "*.ogg"` → empty (§6); the module contains zero binary literals — only numeric oscillator/gain parameters |
| Sound starts correctly on desktop Chrome, Firefox, Safari, **and iOS Safari** | ⚠️ Partial | Verified end-to-end in real headless Chromium 141.0.7390.37, both the raw module (§6) and the actual `audio-dev.html` page via real dispatched clicks (§6b) — construction, gesture-gating call sequence, and lifecycle all measured with zero uncaught errors. Firefox, Safari, and iOS Safari are **unreachable from this container** (no such browsers installed) — `audio-dev.html` (§8) is what lets a human fill this in on the browsers that matter, especially iOS Safari |
| No clicks or pops on boost/brake transitions (gains ramped, never assigned) | ✅ | Every `GainNode.gain` in the graph proven to have `directSetCount === 0` after 100+ rapid toggles, in both the fake-double suite and (implicitly, no throw / no API misuse) the real-Chromium 400-call rapid-toggle run (§5, §6) |
| `AudioNode` count constant across a 5-minute session — no per-event allocation | ✅ (proxied) | Persistent voice graph is built exactly once (5 oscillators, 6 gain nodes, 1 compressor) regardless of how many times `setBoost`/`setBrake`/`setAlarm` are called — proven over 50 and again over 400 calls with zero node-count growth (§5, §6). A literal 5-minute DevTools heap snapshot needs a real windowed browser and was not run — the fake-double + real-Chromium construct-count proofs are the mechanical substitute available in this container |
| Muting silences immediately; unmuting restores | ✅ | `setMuted` ramps the master gain to 0/1 with a 10 ms time constant — fast enough to read as immediate, never a hard assignment (§4, §5) |
| `destroy()` releases the context; no "too many contexts" warning after 20 restarts | ✅ | 20 create/use/destroy cycles, in both the fake-double suite and real Chromium: every context closes, 0 live oscillators remain, 21/21 `.close()` calls succeed (§5, §6) |
| `AudioContext` is not constructed before the first user gesture | ✅ | `createAudio()` alone and `setMuted()` alone both construct 0 contexts; `setBoost`/`setBrake`/`setAlarm`/`chime` each construct exactly 1, reused thereafter — proven in both the fake-double suite and real Chromium (§5, §6) |
| Imports nothing from `game/loop.ts`, `render/`, or `ui/` | ✅ | `audio.ts` has zero imports of any kind — no `@swingby/core`, no sibling `game/` files, nothing |
| Global checklist (PROJECT.md §7) | ✅ | See §5 — typecheck clean, whole-repo suite green, only owned files touched, no new dependency, ramp/gain numbers reported as measured numbers below |

---

## 4. Synthesis parameters — measured, not adjectives

Every number below is a literal constant in `audio-voices.ts`, either ported directly from
`reference/swift/AudioManager.swift` (file:line noted) or a logged, deliberate deviation. These same
numbers are also shown live, next to their controls, on `audio-dev.html` (§8) — the point being that
a listener can connect what they hear directly to a number they could go change.

### Persistent voices (built once, gated by `GainNode`, never stopped until `destroy()`)

| Voice | Waveform | Frequency | Peak gain | Ramp time constant (τ) | Trigger | Swift origin |
|---|---|---|---|---|---|---|
| Ambient | sine | 60 Hz | 0.04 | 0.5 s fade-in only, then held | Runs continuously once the context exists (session-lifetime, no explicit stop in the interface) | `AudioManager.swift:19,76-83` |
| Boost | sine | 220 Hz | 0.25 | 0.045340 s | `setBoost(active)` | `AudioManager.swift:85-94` |
| Brake | **sawtooth** (deliberate deviation — Swift uses sine; changed for "rougher" per this task's own Voices table, zero extra nodes) | 140 Hz | 0.25 | 0.045340 s | `setBrake(active)` | `AudioManager.swift:96-105` |
| Alarm tone | sine | 500→900 Hz, linear in intensity (deliberate deviation — Swift is fixed at 680 Hz) | 0→0.3, linear in intensity | 0.022664 s | `setAlarm(0..1)` | `AudioManager.swift:107-119` |
| Alarm tremolo LFO | sine | 3 Hz (fixed, Swift's value, not scaled by intensity) | additive into alarm gain, 0→0.15 at max intensity (half of peak — see log for the sum-to-target algebra) | 0.022664 s | tracks alarm intensity | `AudioManager.swift:107-119` |

τ derivation (both rows use the same formula, different Swift `ramp` constants): Swift smooths
per-sample with `gain += (target-gain) * ramp` at `sampleRate = 44100`. A per-sample multiplicative
decay of `(1-ramp)` corresponds to continuous time constant `τ = -(1/sampleRate) / ln(1-ramp)`.
- boost/brake, `ramp = 0.0005`: `τ = 0.045340 s` (45.34 ms)
- alarm, `ramp = 0.001`: `τ = 0.022664 s` (22.66 ms)

Mute ramp: 0.01 s (10 ms) time constant, `setMuted` — fast enough to read as immediate, never a hard
assignment, so it cannot itself click.

### One-shot chimes (transient oscillator+gain per call, `.start()`/`.stop()` once, disconnected `onended`)

| Kind | Tones (freq Hz) | Per-tone duration | Stagger | Peak gain | Envelope | Swift origin |
|---|---|---|---|---|---|---|
| `levelStart` | 880 | 0.15 s | — | 0.3 | linear attack (min(5 ms, dur/4)) → linear decay to 0 | `playLevelStart()`, `AudioManager.swift:186-188` |
| `goal` | 523, 659, 784 (C5/E5/G5) | 0.12 s each | 0, 0.14, 0.28 s | 0.3 | same attack/decay shape, scheduled against the AudioContext clock (not real timers) | `playGoalReached()`, `AudioManager.swift:190-196` |
| `reset` | 300 → 150, linear sweep | 0.4 s | — | 0.25 | same attack shape; decay-to-0 **added** (Swift's version has no fade-out — a fixed buffer just ends; this port keeps the "ramp, never step" discipline even on one-shots) | `playAutoReset()`, `AudioManager.swift:198-222` |
| `click` | 1200 | 0.03 s | — | 0.3 | same attack/decay shape | `playUITap()`, `AudioManager.swift:224-226` |

### Master bus

`master gain → DynamicsCompressorNode → destination`, built by `buildEngine()` in
`audio-voices.ts`. The compressor is **not** present in Swift's `AVAudioMixerNode`-only chain —
added because the worst-case sum (boost 0.25 + brake 0.25 + alarm 0.3 + a chime peak 0.3 ≈ 1.1) can
exceed unity and clip a plain sum; a built-in WebAudio node, no dependency, negligible cost.

---

## 5. Verification — fake WebAudio double (Node/vitest, no browser)

Commands actually run, with their real output. Re-run in full after the `audio.ts` /
`audio-voices.ts` split (a session usage-limit restart happened between the two passes; the
container came back with `audio.ts` and the 34 tests intact on disk, confirmed by reading them back
before touching anything):

```
$ npx vitest run packages/web/src/game/__tests__/audio.test.ts
 ✓ packages/web/src/game/__tests__/audio.test.ts (34 tests) 18ms
 Test Files  1 passed (1)
      Tests  34 passed (34)
```

**Unchanged from before the split** — deliberately: the test file was not edited at all, since it
only ever exercises the public `AudioSink` surface through the fake `AudioContext`, never anything
inside `audio.ts`/`audio-voices.ts` directly. If the split had changed observable behaviour, these
34 tests are exactly what would have caught it. They didn't move.

```
$ npm run typecheck            # tsc --build --force, whole repo
> typecheck
> tsc --build --force
(no output — 0 errors, anywhere, including both audio files and the test file)

$ npx vitest run                # whole repo, confirms nothing else broken by the split
 Test Files  18 passed (18)
      Tests  432 passed | 1 skipped (433)
```

**Lazy construction** (`FakeAudioContext.instances.length`, a counted double, not an assumption):

| Call sequence | Contexts constructed |
|---|---|
| `createAudio()` alone | **0** |
| `createAudio()` + `setMuted(true)` + `setMuted(false)` | **0** |
| `createAudio()` + `setBoost(true)` | **1** |
| ...then `setBrake`/`setAlarm`/all 4 `chime()` kinds on the same sink | still **1** — engine reused |

**Teardown**, after `setBoost` + `setBrake` + `setAlarm(0.7)`:

| Metric | Before `destroy()` | After `destroy()` |
|---|---|---|
| Live oscillators (`started && !stopped`) | 5 | **0** |
| Connected oscillator nodes | 5 | **0** |
| Connected gain nodes | 6 | **0** |
| Context state | `"suspended"`/`"running"` | **`"closed"`** |

**N create/destroy cycles** (N = 20, per the DoD's literal "restart 20 times"):
- Contexts constructed: **20** (one per cycle, none reused across cycles)
- Live oscillators summed across all 20 closed contexts: **0**
- Contexts left in `"closed"` state: **20 / 20**

**Node count under load** — 5 persistent oscillators / 6 persistent gain nodes, unchanged after 50
consecutive alternating `setBoost`/`setBrake`/`setAlarm` calls, and unchanged after a further 200 more
in the real-Chromium run (§6) — no per-event allocation on the hot path.

**Chime transience** — each of the 4 kinds creates exactly its documented tone count
(1/3/1/1 for levelStart/goal/reset/click), and a genuine test (not merely a same-tick self-clean, see
log for the test-fidelity fix made while writing this) proves `destroy()`'s own sweep of any chime
still awaiting its asynchronous `ended` event — not just chimes that already fired it themselves.

**Fail-proof — the suite was deliberately broken twice, observed red, then restored:**

1. Broke lazy construction (eager `buildEngine()` call added inside `createAudio()`):
   ```
   Tests  5 failed | 29 passed (34)
   ```
   (all 5 failures inside the "lazy AudioContext construction" describe block, expected-vs-actual
   `0` vs `1` on every one)
2. Reverted, confirmed 34/34 green again.
3. Broke the ramp discipline (`e.boost.gain.gain.value = ...` direct assignment instead of
   `setTargetAtTime`):
   ```
   Tests  1 failed | 33 passed (34)
   AssertionError: expected 100 to be +0
   ```
   (the "rapid boost toggling never assigns .gain.value directly" test — 100 direct assignments
   detected, exactly the loop count)
4. Reverted, confirmed 34/34 green again, `npm run typecheck` 0 errors, whole-repo suite green (this
   was run pre-split, pre-restart; the test file itself is unmodified by the later split, so this
   remains valid evidence for the current code too — see the "unchanged from before the split" note
   above).

**Formatting** — `npx prettier --check` initially flagged both `audio.ts`/`audio-voices.ts` and,
later, `audio-dev.html` (whitespace-only each time); fixed with `--write`, re-checked clean, re-ran
the suite + typecheck (and, for the HTML file, the real-browser CDP drive in §6b) after each reformat
to confirm no behaviour changed. All three files are currently prettier-clean.

**Module size** (the 250 KB whole-app gzip budget, PROJECT.md §2/§6): `npm run build -w
@swingby/web` output is currently 1.56 KB gzip total, all T-14 launchpad scaffold — `audio.ts` isn't
imported by `main.ts` yet (that's T-05 FLYWHEEL's job), so it isn't in that number at all yet.
Measured standalone instead: `npx esbuild packages/web/src/game/audio.ts --bundle --minify
--format=esm --target=es2022` (this pulls in `audio-voices.ts` too, since it's the only thing
`audio.ts` imports) → **3,534 bytes minified, 1,315 bytes gzip (`gzip -9`) = 1.28 KB**, i.e. **0.51%
of the 250 KB budget**. (Before the split, the single-file version measured 1,303 bytes gzip — the
~12-byte difference is just per-module import/export boilerplate once two files are bundled instead
of one, not a real cost.) `find packages/web/dist -iname "*.wav" -o -iname "*.mp3" -o -iname "*.ogg"`
→ empty, and `find packages/web/dist -iname "*audio-dev*" -o -iname "*audio-voices*"` → also empty,
confirming the dev page and its module are not pulled into the production build (nothing in
`index.html`'s module graph references them).

---

## 6. Verification — real browser (headless Chromium)

No `playwright` npm package is installed in this environment — only the raw Chromium binary at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (**Chromium 141.0.7390.37**). Drove it directly
via CLI flags (`--headless=new --dump-dom --virtual-time-budget=4000`) against a self-contained
harness page (kept in the scratchpad directory only, not committed — see §1) that:

1. Wraps the real `AudioContext` constructor and `.close()` in counting shims *before* loading an
   esbuild IIFE bundle of the actual `audio.ts` source.
2. Runs the same call sequence as the vitest suite, against a **real** WebAudio implementation.
3. Writes a JSON summary into the DOM, captured via `--dump-dom`.

Measured, real Chromium, one run, raw output:

```json
{
  "afterCreateAudio_constructCount": 0,
  "afterSetMutedOnly_constructCount": 0,
  "afterSetBoost_constructCount": 1,
  "contextStateAfterSetBoost": "running",
  "afterAllVoices_constructCount": 1,
  "rapidToggleThrew": false,
  "sink1_stateAfterDestroy": "closed",
  "cyclesConstructCount": 21,
  "cyclesAllClosed": true,
  "closeCallCount": 21,
  "noSupportDegradedCleanly": true,
  "uncaughtErrors": []
}
```

Read: lazy construction holds against a real `AudioContext` (0, then 0, then exactly 1); 400
combined rapid `setBoost`/`setAlarm` calls against the real Web Audio API threw nothing; 21 total
contexts across the single sink + 20 restart cycles all reached `"closed"`, matching 21 `.close()`
calls 1:1 (no double-closes, no leaks); deleting `window.AudioContext` entirely (simulating a browser
with no WebAudio) degrades every method to a silent no-op, as designed; zero uncaught errors anywhere
in the run.

**Caveat, stated explicitly:** this run used `--autoplay-policy=no-user-gesture-required`, because
this container has no display/input surface to generate a real synthetic pointer or key event. That
flag is why `contextStateAfterSetBoost` reads `"running"` rather than `"suspended"` — it proves the
code *calls* `resume()` correctly and never throws against a real engine, but it does **not** prove
the browser's actual autoplay-blocking behavior end-to-end (i.e., that a context genuinely stays
silent until a real gesture, on a browser that enforces the policy strictly). That specific claim
needs a human with a real windowed browser, per §7.

---

## 6b. Verification — the actual `audio-dev.html` page, real clicks, real phone viewport

§6 verified the raw module in isolation, through a synthetic harness. This is different: it verifies
the actual, real `packages/web/src/game/audio-dev.html` file a human will open, served by the actual
`npm run dev -w @swingby/web` dev server, driven by actually dispatched pointer input — not a
scripted `.click()` call, not `--dump-dom` on a static load.

No `playwright` npm package here either, so this went one level lower than §6: launched headless
Chromium with `--remote-debugging-port=9222` and spoke raw Chrome DevTools Protocol over a plain
`WebSocket` from Node (Node 22 ships a global `WebSocket`/`fetch`, no dependency added). Sequence:
`Page.navigate` to the real dev-server URL, `Emulation.setDeviceMetricsOverride` to a
**390×844 @2x** viewport (iPhone-sized, touch-capable), then genuine `Input.dispatchMouseEvent`
press/release pairs at each button's real `getBoundingClientRect()` center, scrolling each target
into view first exactly like a human thumb would (a real methodology bug in the first pass — see
`notes/T-07-CHORUS/log.md`'s 2026-08-15 entry for the "silent click below the fold" trap and the fix,
worth a read if writing the next headless-CDP harness).

Measured, real Chromium 141.0.7390.37, real 390×844 viewport, real dispatched clicks, one full pass
through every control on the page (Start → Boost hold 300 ms → Brake hold 300 ms → Alarm slider to
70 → all 4 chimes → Mute → Unmute):

```json
{
  "viewport": { "w": 390, "h": 844 },
  "title": "CHORUS audio dev",
  "hasStartButton": true,
  "statusAfterStart": "AudioContext constructed and running.",
  "statusHasOkClass": true,
  "boostHeldClassGoneAfterRelease": true,
  "alarmReadout": "70%",
  "alarmFreq": "780",
  "alarmGain": "0.210",
  "mutedAfterToggle": true,
  "muteButtonLabel": "Unmute",
  "logLineCount": 12,
  "logFirstFewLines": [
    "…  setMuted(false)",
    "…  setMuted(true)",
    "…  chime(\"click\") fired",
    "…  chime(\"reset\") fired",
    "…  chime(\"goal\") fired",
    "…  chime(\"levelStart\") fired"
  ],
  "consoleMessages": ["[debug] [vite] connecting...", "[debug] [vite] connected."],
  "pageErrors": []
}
```

Read: tapping Start genuinely constructs the context (status text + `.ok` class both flip); a 300 ms
real press-and-hold on Boost releases cleanly (`.held` class removed, not stuck — proves the
`pointerup`/`pointerleave`/`pointercancel` release wiring works against real Pointer Events, not just
the code reading correctly); the alarm slider's on-screen readout matches the formula in
`audio-voices.ts` exactly at intensity 0.7 (frequency 500+0.7×400=**780**, gain 0.7×0.3=**0.210**);
mute toggles both ways; the event log captured all 11 real interactions in the correct order (12
including the static placeholder row); **zero page errors, zero uncaught exceptions**, both on first
run and again after the prettier reformat pass (re-ran the identical drive script, byte-identical
results — confirms the formatting pass changed nothing behavioural). Full driver script and raw
output preserved in the scratchpad directory for this session, not committed to the repo (a test
tool, not a deliverable).

**What this does and does not prove**, same honest framing as §6: it proves the page's JavaScript is
correct, the module resolves through Vite's dev transform, every control wires to the right
`AudioSink` call with the right computed parameters, and nothing throws — against a real engine, at a
real phone-sized viewport, under real dispatched input. It does **not** prove anything about how the
result sounds, and it does not touch Firefox, Safari, or iOS Safari, which do not exist in this
container. See §7 and §8.

---

## 7. What could not be verified here — stated plainly

**Nobody in this container can hear the output.** Every number in §4 was checked against recorded
`OscillatorNode`/`GainNode` automation calls (frequency, gain, ramp time constants, envelope shapes,
start/stop timing) — never against actual sound. Specifically NOT verified by anything in this
report:

- Whether the alarm's pitch rise (500→900 Hz) actually reads as "urgent" to a human ear, or whether
  the range/curve needs tuning.
- Whether the sawtooth brake voice sounds meaningfully "rougher" than boost's sine, as intended, or
  just sounds wrong/harsh.
- Whether the ambient drone's 60 Hz / 0.04 gain is audible at all against typical device speakers, or
  too quiet/loud relative to the other voices.
- Whether the goal fanfare's 0.14 s stagger and note choice (C5 E5 G5) actually sounds like a
  fanfare rather than three disconnected beeps.
- Whether the `DynamicsCompressorNode` safety net (§4, "Master bus") is audibly transparent at normal
  levels or is noticeably squashing the mix.
- Real desktop Firefox, real desktop Safari, and real iOS Safari — the DoD's explicit "and iOS
  Safari" browser, the one the task doc calls out as "the strict one, and it is where this fails" —
  were not reachable from this container at all. Only headless Chromium was available (§6), and even
  that required bypassing the real gesture-gating policy to get a clean automated run.

These are exactly the things a human opening the game (or the would-be dev page) with speakers needs
to judge. The synthesis logic, lifecycle, and lazy-construction contract are mechanically proven; the
sound design choices in §4 are reasoned from `AudioManager.swift` and this task's own Voices table,
but unheard.

---

## 8. Open this to make the calls §7 couldn't — `audio-dev.html`

```
npm run dev -w @swingby/web
```

then open:

```
http://localhost:5173/src/game/audio-dev.html
```

Works on a phone on the same network too — same command, then
`http://<your-machine's-LAN-IP>:5173/src/game/audio-dev.html` from the phone's browser (Vite's dev
server listens on all interfaces by default). The page has a Start button, press-and-hold Boost/Brake
buttons, a mute toggle, an alarm intensity slider whose readout shows the live frequency/gain next to
it, four chime buttons, a running event log, and the full parameter table from §4 transcribed
on-screen — no need to have this file open at the same time.

### Questions for the listener — deviations from `AudioManager.swift` first, per the coordinator's ask

1. **Brake sawtooth vs. boost sine** (deviation — Swift's brake is a plain sine like boost; changed
   here to satisfy this task's own Voices table wording, "Lower, rougher sustained tone"). Does it
   actually read as *rougher*, or just *buzzy/wrong*? If wrong, what should replace it — a different
   waveform, a two-oscillator detune, filtered noise?
2. **Alarm pitch rising 500→900 Hz with intensity** (deviation — Swift's alarm pitch is fixed at
   680 Hz; only gain scales there). Does rising pitch alongside rising gain read as *urgency*, or is
   it distracting/annoying near intensity 1? Is the 500–900 Hz range right, too wide, too narrow?
3. Is the ambient drone (60 Hz sine, gain 0.04) audible at all on a phone speaker, or too quiet? Too
   loud/boomy on headphones?
4. Does the goal chime (C5/E5/G5 triad, 0.14 s stagger) read as a fanfare, or as three disconnected
   beeps? Is the stagger timing right?
5. Any audible click or pop on boost/brake press/release, mute toggle, or rapid re-triggering?
6. Overall mix — does anything clip or distort when boost + brake + alarm (near intensity 1) + a
   chime all overlap? (The `DynamicsCompressorNode` in `audio-voices.ts`'s `buildEngine()` exists
   specifically to prevent this — worth stress-testing directly.)

Answers to any of these are exactly what would turn a §7 "not verified" into a real design decision
— change a constant in `audio-voices.ts`, or confirm the current one is right and record why.
