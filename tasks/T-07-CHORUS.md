# T-07 · CHORUS — Procedural audio

**Area:** `packages/web/src/game/audio.ts` · **Depends on:** nothing · **Blocks:** nothing

## Goal

All game audio synthesized at runtime with WebAudio. **No audio files ship.**

## Owned files

```
packages/web/src/game/audio.ts
packages/web/src/game/audio-voices.ts
```

## Why procedural

The Godot project ships 1.2 MB of `.wav` files whose licensing is unresolved — `ToDos/0 Not
started.md` still lists "Figure out sound license", and there is no license file in the repo. Public
hosting on a personal domain is a different exposure from sharing a desktop build. Synthesis removes
the question entirely and removes 1.2 MB from the download. Decision recorded in DESIGN.md §9.1.

## Reference

`reference/swift/AudioManager.swift` — **the one place the Swift rewrite is the
reference rather than the Godot project.** It already synthesizes everything with
`AVAudioSourceNode` sine generation: `ambientSamples`, `boostSamples`, `brakeSamples`,
`alarmSamples`, and `playChime(frequency:duration:)`. Those map almost directly onto WebAudio
oscillators and gain nodes.

`reference/godot/scripts/AudioManager.gd` defines *when* each sound plays — the trigger logic is worth
reading even though the samples are not.

## Interface

Exactly as in [INTERFACES.md](../INTERFACES.md#webgameaudiots--t-07-chorus).

## Voices

| Voice | Character | Trigger |
|---|---|---|
| Ambient | Low continuous drone, always on during play | Level start |
| Boost | Sustained tone, fades in/out with input | `setBoost` |
| Brake | Lower, rougher sustained tone | `setBrake` |
| Alarm | Rises in pitch and volume as bounds approach | `setAlarm(0..1)` |
| Level start | Short chime | `chime("levelStart")` |
| Goal | Fanfare — a few chime tones in sequence | `chime("goal")` |
| Reset | Soft descending cue | `chime("reset")` |
| Click | Very short UI blip | `chime("click")` |

## Constraints that will bite

1. **Autoplay policy.** Do not construct an `AudioContext` in `createAudio()`. Create it lazily on
   the first user gesture, or it starts `suspended` and everything is silent with no error. Expose
   `resume()` internally and call it from the first pointer/key event.

2. **Never start and stop oscillators per event.** A stopped `OscillatorNode` cannot restart, and
   allocating one per frame is a leak. Keep persistent oscillators running and gate them with
   `GainNode`s.

3. **Ramp, never set.** Use `setTargetAtTime` or `linearRampToValueAtTime` on gains. Assigning
   `gain.value` directly produces an audible click on every change — and `setBoost` is called
   whenever input changes, which is constantly.

4. **Alarm is continuous, not binary.** `setAlarm` takes 0–1 and should map smoothly to gain and
   pitch. It is called every frame while near the bounds; make it cheap and idempotent.

5. **Respect the mute setting** from T-10 VAULT, and suspend the context when the tab is hidden.

## Deliverables

| # | Artifact | Path |
|---|---|---|
| 1 | `createAudio` + the `AudioSink` interface | `packages/web/src/game/audio.ts` |
| 2 | Voice synthesis: ambient, boost, brake, alarm, chimes | `packages/web/src/game/audio-voices.ts` |
| 3 | Dev page: a button per voice, alarm intensity slider | `packages/web/src/game/audio-dev.html` |
| 4 | Browser test matrix results, in the PR | — |

## Definition of done

- [ ] **No audio file of any kind in the bundle** — `find dist -name "*.wav" -o -name "*.mp3"` empty
- [ ] Sound starts correctly on desktop Chrome, Firefox, Safari, **and iOS Safari**
- [ ] No clicks or pops on boost/brake transitions (gains ramped, never assigned)
- [ ] AudioNode count constant across a 5-minute session — no per-event allocation
- [ ] Muting silences immediately; unmuting restores
- [ ] `destroy()` releases the context; no "too many contexts" warning after 20 restarts
- [ ] `AudioContext` is not constructed before the first user gesture
- [ ] Imports nothing from `game/loop.ts`, `render/`, or `ui/`
- [ ] Plus the global checklist in [PROJECT.md §7](../PROJECT.md#7-definition-of-done-globally)

## Working standalone

A dev page with a button per voice and sliders for alarm intensity is enough to build and demo this
task entirely on its own.

## How to verify

```bash
npm run dev -w @swingby/web
# open http://localhost:5173/src/game/audio-dev.html
```

**1. No files ship** — the licensing requirement, mechanically checked:

```bash
npm run build -w @swingby/web
find packages/web/dist -name "*.wav" -o -name "*.mp3" -o -name "*.ogg"   # must be empty
```

**2. Gesture policy.** Hard-reload the dev page and, **without clicking anything**, confirm no
`AudioContext` has been constructed (`performance.getEntries()` or a breakpoint on the constructor).
Then click once and confirm sound starts. Repeat on **iOS Safari** — it is the strict one, and it is
where this fails.

**3. Clicks and pops.** Toggle boost rapidly (10+ times per second) on the dev page. Any audible
click means a gain is being assigned rather than ramped.

**4. Node count.** DevTools → Memory heap snapshot, then play for 5 minutes with heavy
boost/brake use, then snapshot again. `AudioNode` count must be flat. Growth means nodes are being
created per event and never released.

**5. Lifecycle.** Restart a level 20 times. The console must not warn about too many `AudioContext`
instances — that is the browser telling you `destroy()` is not releasing.

**Browser matrix to report:** desktop Chrome, Firefox, Safari, iOS Safari. Note the version of each.
