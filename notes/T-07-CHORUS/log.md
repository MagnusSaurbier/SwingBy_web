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
