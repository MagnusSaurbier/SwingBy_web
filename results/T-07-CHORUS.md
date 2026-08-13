# T-07 CHORUS — results

Procedural WebAudio for SwingBy Web. All sound is synthesized at runtime with `OscillatorNode` /
`GainNode` graphs — no audio file of any kind is imported, embedded, or fetched.

Full reasoning trail (what was ported from `AudioManager.swift` line-by-line, the deliberate
deviations, dead ends ruled out, the exact tau derivations): `notes/T-07-CHORUS/log.md`.

---

## 1. A file-ownership conflict, resolved up front

`tasks/T-07-CHORUS.md`'s "Owned files" list and Deliverable #3 ask for `audio-voices.ts` and a
committed `audio-dev.html` dev page. The orchestrator's session-level hard rule 1 says: *"Write only
`packages/web/src/game/audio.ts` and your tests... Touch only `audio.ts` and your own test file.
Nothing else anywhere."* INTERFACES.md's file-ownership table — the actually-frozen contract — lists
only `packages/web/src/game/audio.ts` for T-07, so the task doc's extra files are not part of the
frozen contract. Per the standing instruction that the launching agent's messages direct this work
(and consistent with T-06 HELM's identical resolution for its own `input-dev.html`, see
`notes/T-06-HELM/log.md`), the session rule wins:

- All voice synthesis lives inside `audio.ts` itself — no separate `audio-voices.ts`.
- No `audio-dev.html` was committed to the repo. A manual verification harness was built instead,
  entirely in the scratchpad directory (outside the repo, not a deliverable) — see §6.

---

## 2. Deliverables

| # | Artifact | Path | Status |
|---|---|---|---|
| 1 | `createAudio` + the `AudioSink` interface | `packages/web/src/game/audio.ts` | Done — matches INTERFACES.md exactly |
| 2 | Voice synthesis: ambient, boost, brake, alarm, chimes | folded into `packages/web/src/game/audio.ts` | Done — see §4 for the parameter table |
| 3 | Dev page (button per voice, alarm slider) | *not committed* — see §1 | Intentionally not created, per session hard rule; a scratchpad-only equivalent harness was used for real-browser verification instead (§6) |
| 4 | Browser test matrix results | this file, §6 | Partial — only headless Chromium was reachable in this container; no Firefox/Safari/iOS Safari device exists here (§7) |
| — | Unit tests | `packages/web/src/game/__tests__/audio.test.ts` | Done — 34 tests, all passing (§5) |
| — | Thought log | `notes/T-07-CHORUS/log.md` | Done, append-only, kept current throughout |

No file outside `packages/web/src/game/audio.ts`, its test file, `notes/T-07-CHORUS/**`, and this
results file was written or modified.

---

## 3. Definition of done

| Item | Status | Reason |
|---|---|---|
| No audio file of any kind in the bundle | ✅ | `find dist -name "*.wav" -o -name "*.mp3" -o -name "*.ogg"` → empty (§6); the module contains zero binary literals — only numeric oscillator/gain parameters |
| Sound starts correctly on desktop Chrome, Firefox, Safari, **and iOS Safari** | ⚠️ Partial | Verified end-to-end in real headless Chromium 141.0.7390.37 (§6) — construction, gesture-gating call sequence, and lifecycle all measured with zero uncaught errors. Firefox, Safari, and iOS Safari are **unreachable from this container** (no such browsers installed) — cannot be verified here, stated plainly rather than assumed |
| No clicks or pops on boost/brake transitions (gains ramped, never assigned) | ✅ | Every `GainNode.gain` in the graph proven to have `directSetCount === 0` after 100+ rapid toggles, in both the fake-double suite and (implicitly, no throw / no API misuse) the real-Chromium 400-call rapid-toggle run (§5, §6) |
| `AudioNode` count constant across a 5-minute session — no per-event allocation | ✅ (proxied) | Persistent voice graph is built exactly once (5 oscillators, 6 gain nodes, 1 compressor) regardless of how many times `setBoost`/`setBrake`/`setAlarm` are called — proven over 50 and again over 400 calls with zero node-count growth (§5, §6). A literal 5-minute DevTools heap snapshot needs a real windowed browser and was not run — the fake-double + real-Chromium construct-count proofs are the mechanical substitute available in this container |
| Muting silences immediately; unmuting restores | ✅ | `setMuted` ramps the master gain to 0/1 with a 10 ms time constant — fast enough to read as immediate, never a hard assignment (§4, §5) |
| `destroy()` releases the context; no "too many contexts" warning after 20 restarts | ✅ | 20 create/use/destroy cycles, in both the fake-double suite and real Chromium: every context closes, 0 live oscillators remain, 21/21 `.close()` calls succeed (§5, §6) |
| `AudioContext` is not constructed before the first user gesture | ✅ | `createAudio()` alone and `setMuted()` alone both construct 0 contexts; `setBoost`/`setBrake`/`setAlarm`/`chime` each construct exactly 1, reused thereafter — proven in both the fake-double suite and real Chromium (§5, §6) |
| Imports nothing from `game/loop.ts`, `render/`, or `ui/` | ✅ | `audio.ts` has zero imports of any kind — no `@swingby/core`, no sibling `game/` files, nothing |
| Global checklist (PROJECT.md §7) | ✅ | See §5 — typecheck clean, whole-repo suite green, only owned files touched, no new dependency, ramp/gain numbers reported as measured numbers below |

---

## 4. Synthesis parameters — measured, not adjectives

Every number below is a literal constant in `audio.ts`, either ported directly from
`reference/swift/AudioManager.swift` (file:line noted) or a logged, deliberate deviation.

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

`master gain → DynamicsCompressorNode → destination`. The compressor is **not** present in Swift's
`AVAudioMixerNode`-only chain — added because the worst-case sum (boost 0.25 + brake 0.25 + alarm 0.3
+ a chime peak 0.3 ≈ 1.1) can exceed unity and clip a plain sum; a built-in WebAudio node, no
dependency, negligible cost.

---

## 5. Verification — fake WebAudio double (Node/vitest, no browser)

Commands actually run, with their real output:

```
$ npx vitest run packages/web/src/game/__tests__/audio.test.ts
 ✓ packages/web/src/game/__tests__/audio.test.ts (34 tests) 24ms
 Test Files  1 passed (1)
      Tests  34 passed (34)

$ npm run typecheck            # tsc --build --force, whole repo
> typecheck
> tsc --build --force
(no output — 0 errors, anywhere, including audio.ts and its test file)

$ npx vitest run                # whole repo, confirms nothing else broken
 Test Files  18 passed (18)
      Tests  428 passed | 1 skipped (429)
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
4. Reverted, confirmed 34/34 green again, `npm run typecheck` 0 errors, whole-repo suite still
   428/1/0.

**Formatting** — `npx prettier --check` initially flagged both files (whitespace-only); fixed with
`--write`, re-checked clean, re-ran the suite + typecheck after the reformat to confirm no behaviour
changed (still 34/34, still 0 errors).

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
