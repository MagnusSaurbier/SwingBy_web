/**
 * Voice synthesis.
 *
 * Everything about HOW each voice sounds, and how its runtime parameters are applied to a live
 * WebAudio graph, lives here: the persistent ambient/boost/brake/alarm voices, the four one-shot
 * chimes, and the engine's build/teardown lifecycle. `audio.ts` owns WHEN this module's functions
 * run — the lazy-construction contract and the public `AudioSink` surface — and holds no synthesis
 * parameters of its own; it only delegates to this module.
 *
 * Split out of a single `audio.ts` after the first review pass. Behaviour-preserving by
 * construction: every constant, ramp time constant, frequency, and envelope shape below is
 * unchanged from the pre-split version — the 34 tests in `__tests__/audio.test.ts` exercise this
 * module only indirectly, through `createAudio()`'s public surface, and pass unmodified. See
 * notes/archive/T-07-CHORUS/log.md for the full derivations and `AudioManager.swift` file:line
 * citations; this file keeps only the "what", not the "why", to avoid a second copy of the same
 * commentary drifting out of sync with the log.
 */

// ---------------------------------------------------------------------------
// Synthesis parameters — every number here is deliberate. See log for derivations.
// ---------------------------------------------------------------------------

/** Ambient drone: AudioManager.swift:19,76-83 — 60 Hz sine, constant low gain, always running. */
export const AMBIENT_FREQ_HZ = 60;
export const AMBIENT_GAIN = 0.04;
/** Soft fade-in the first time the engine starts, so the drone doesn't step in at full gain. */
export const AMBIENT_FADE_IN_TAU_S = 0.5;

/** Boost: AudioManager.swift:85-94 — 220 Hz sine, gain 0↔0.25. */
export const BOOST_FREQ_HZ = 220;
export const BOOST_GAIN = 0.25;

/**
 * Brake: AudioManager.swift:96-105 — 140 Hz, gain 0↔0.25, same ramp speed as boost. Waveform
 * deliberately changed from sine to sawtooth (Swift is a plain sine like boost) to satisfy this
 * task's own Voices table ("Lower, rougher sustained tone") — see log, "dead end already ruled
 * out". Zero extra nodes; only `OscillatorNode.type` differs from a literal Swift port.
 */
export const BRAKE_FREQ_HZ = 140;
export const BRAKE_GAIN = 0.25;

/**
 * Boost/brake gain ramp time constant, derived from Swift's per-sample smoothing coefficient
 * (`gain += (target-gain) * ramp`, ramp=0.0005 @ sampleRate=44100 — AudioManager.swift:86,89-90,
 * 97,100-101). A per-sample multiplicative decay of (1-ramp) at sample period 1/sampleRate
 * corresponds to a continuous time constant `tau = -(1/sampleRate) / ln(1-ramp)`:
 *   ln(0.9995) ≈ -0.00050013  =>  tau ≈ 0.045341 s
 */
export const VOICE_RAMP_TAU_S = 0.045;

/** Alarm: AudioManager.swift:107-119 — sine, tremolo LFO, gain = intensity * 0.3. */
export const ALARM_MAX_GAIN = 0.3;
export const ALARM_LFO_HZ = 3;
/**
 * Frequency is FIXED at 680 Hz in Swift; intensity only scales gain there. This task's Voices
 * table asks for "rises in pitch and volume as bounds approach", which Swift's alarm does not do —
 * deliberate deviation, logged. Range chosen to bracket Swift's 680 Hz center reasonably.
 */
export const ALARM_BASE_FREQ_HZ = 500;
export const ALARM_MAX_FREQ_HZ = 900;
/**
 * Alarm ramp time constant, same derivation as VOICE_RAMP_TAU_S but for Swift's alarm ramp=0.001
 * (AudioManager.swift:108,112): ln(0.999) ≈ -0.0010005 => tau ≈ 0.022665 s.
 */
export const ALARM_RAMP_TAU_S = 0.023;

/** Mute ramp: fast enough to read as "immediate" (DoD: "Muting silences immediately") but still a
 *  ramp, never a direct assignment, so it can never itself produce a click. */
export const MUTE_RAMP_TAU_S = 0.01;

export interface ChimeTone {
  readonly freq: number;
  /** Present only for the frequency-sweeping "reset" cue. */
  readonly freqEnd?: number;
  readonly startOffset: number;
  readonly duration: number;
  readonly peakGain: number;
}

export type ChimeKind = "levelStart" | "goal" | "reset" | "click";

/**
 * AudioManager.swift:186-226 ported directly:
 *  - levelStart = playLevelStart(): 880 Hz, 0.15 s.
 *  - goal       = playGoalReached(): C5 E5 G5 triad (523/659/784 Hz), 0.12 s each, staggered
 *                 0.14 s apart. Scheduled against the AudioContext clock up front rather than via
 *                 real timers — sample-accurate, no cleanup timer needed.
 *  - reset      = playAutoReset(): 0.4 s linear sweep 300→150 Hz, amplitude 0.25. Swift's version
 *                 has no fade-out (a fixed-length buffer just ends); this port adds one (see log)
 *                 to stay consistent with "ramp, never step" even on one-shots.
 *  - click      = playUITap(): 1200 Hz, 0.03 s (same `playChime` envelope as the others).
 */
export const CHIME_DEFS: Readonly<Record<ChimeKind, readonly ChimeTone[]>> = {
  levelStart: [{ freq: 880, startOffset: 0, duration: 0.15, peakGain: 0.3 }],
  goal: [
    { freq: 523, startOffset: 0, duration: 0.12, peakGain: 0.3 },
    { freq: 659, startOffset: 0.14, duration: 0.12, peakGain: 0.3 },
    { freq: 784, startOffset: 0.28, duration: 0.12, peakGain: 0.3 },
  ],
  reset: [
    { freq: 300, freqEnd: 150, startOffset: 0, duration: 0.4, peakGain: 0.25 },
  ],
  click: [{ freq: 1200, startOffset: 0, duration: 0.03, peakGain: 0.3 }],
};

// ---------------------------------------------------------------------------
// Engine — the node graph. buildEngine() once per AudioSink, teardownEngine() once, on destroy().
// ---------------------------------------------------------------------------

export interface Voice {
  readonly osc: OscillatorNode;
  readonly gain: GainNode;
}

export interface AlarmVoice {
  readonly osc: OscillatorNode;
  readonly gain: GainNode;
  readonly lfoOsc: OscillatorNode;
  readonly lfoGain: GainNode;
}

export interface ChimeVoice {
  readonly osc: OscillatorNode;
  readonly gain: GainNode;
}

export interface Engine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly compressor: DynamicsCompressorNode;
  readonly ambient: Voice;
  readonly boost: Voice;
  readonly brake: Voice;
  readonly alarm: AlarmVoice;
  /** Transient per-chime nodes, tracked only so destroy() can stop/disconnect any still in flight. */
  readonly activeChimes: Set<ChimeVoice>;
  /** Removes every environment listener (visibilitychange / window focus+blur) audio.ts attached.
   *  Set by audio.ts once the engine is built; invoked by teardownEngine(). */
  envCleanup: (() => void) | null;
}

function makeVoice(
  ctx: AudioContext,
  type: OscillatorType,
  freqHz: number,
  dest: AudioNode,
): Voice {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freqHz; // constant pitch, set once before start() — no runtime click risk
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  osc.connect(gain);
  gain.connect(dest);
  osc.start();
  return { osc, gain };
}

/** Builds the full persistent node graph: master → compressor → destination, with the four
 *  always-running voices (ambient/boost/brake/alarm+LFO) gated to zero gain until their control
 *  functions below raise them. Called exactly once per `AudioSink`, lazily, by `audio.ts`. */
export function buildEngine(ctx: AudioContext): Engine {
  const master = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();
  master.connect(compressor);
  compressor.connect(ctx.destination);

  const ambient = makeVoice(ctx, "sine", AMBIENT_FREQ_HZ, master);
  ambient.gain.gain.setTargetAtTime(
    AMBIENT_GAIN,
    ctx.currentTime,
    AMBIENT_FADE_IN_TAU_S,
  );

  const boost = makeVoice(ctx, "sine", BOOST_FREQ_HZ, master);
  const brake = makeVoice(ctx, "sawtooth", BRAKE_FREQ_HZ, master);

  const alarmOsc = ctx.createOscillator();
  alarmOsc.type = "sine";
  alarmOsc.frequency.value = ALARM_BASE_FREQ_HZ;
  const alarmGain = ctx.createGain();
  alarmGain.gain.setValueAtTime(0, ctx.currentTime);
  alarmOsc.connect(alarmGain);
  alarmGain.connect(master);
  alarmOsc.start();

  const lfoOsc = ctx.createOscillator();
  lfoOsc.type = "sine";
  lfoOsc.frequency.value = ALARM_LFO_HZ;
  const lfoGain = ctx.createGain();
  lfoGain.gain.setValueAtTime(0, ctx.currentTime);
  lfoOsc.connect(lfoGain);
  lfoGain.connect(alarmGain.gain); // AudioParam inputs sum with its scheduled value
  lfoOsc.start();

  return {
    ctx,
    master,
    compressor,
    ambient,
    boost,
    brake,
    alarm: { osc: alarmOsc, gain: alarmGain, lfoOsc, lfoGain },
    activeChimes: new Set(),
    envCleanup: null,
  };
}

function stopAndDisconnect(
  osc: OscillatorNode,
  gain: GainNode,
  at: number,
): void {
  try {
    osc.stop(at);
  } catch {
    // Already stopped — happens if destroy() races a chime's own natural end. Harmless.
  }
  osc.disconnect();
  gain.disconnect();
}

/** Tears down every node in the graph and closes the context. Called exactly once, from
 *  `AudioSink.destroy()`. Safe to call on an engine with chimes still in flight — sweeps
 *  `activeChimes` itself rather than relying on their `onended` handlers to have already fired. */
export function teardownEngine(e: Engine): void {
  if (e.envCleanup) {
    e.envCleanup();
    e.envCleanup = null;
  }
  const now = e.ctx.currentTime;
  stopAndDisconnect(e.ambient.osc, e.ambient.gain, now);
  stopAndDisconnect(e.boost.osc, e.boost.gain, now);
  stopAndDisconnect(e.brake.osc, e.brake.gain, now);
  stopAndDisconnect(e.alarm.osc, e.alarm.gain, now);
  stopAndDisconnect(e.alarm.lfoOsc, e.alarm.lfoGain, now);
  for (const chime of e.activeChimes) {
    stopAndDisconnect(chime.osc, chime.gain, now);
  }
  e.activeChimes.clear();
  e.master.disconnect();
  e.compressor.disconnect();
  void e.ctx.close().catch(() => {
    // Closing an already-closed/failed context is not actionable — audio is non-critical.
  });
}

/** Schedules one of the four one-shot chimes against `e.master`. Transient oscillator+gain per
 *  tone, started and stopped once, disconnected `onended` — the one place per-event node
 *  allocation is correct rather than a leak (see log: chimes are rare, discrete events, not the
 *  144 Hz-driven continuous voices the "never start/stop per event" rule is about). */
export function playChime(e: Engine, kind: ChimeKind): void {
  const now = e.ctx.currentTime;
  for (const tone of CHIME_DEFS[kind]) {
    const osc = e.ctx.createOscillator();
    osc.type = "sine";
    const gain = e.ctx.createGain();
    osc.connect(gain);
    gain.connect(e.master);

    const start = now + tone.startOffset;
    const end = start + tone.duration;
    const attack = Math.min(0.005, tone.duration / 4);

    osc.frequency.setValueAtTime(tone.freq, start);
    if (tone.freqEnd !== undefined) {
      osc.frequency.linearRampToValueAtTime(tone.freqEnd, end);
    }

    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(tone.peakGain, start + attack);
    gain.gain.linearRampToValueAtTime(0, end);

    osc.start(start);
    osc.stop(end + 0.02);

    const voice: ChimeVoice = { osc, gain };
    e.activeChimes.add(voice);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      e.activeChimes.delete(voice);
    };
  }
}

// ---------------------------------------------------------------------------
// Per-voice control — applies a target state to an already-built engine's parameters. Ramped,
// never assigned (see log, "no clicks or pops"). Cheap and idempotent — safe to call every frame.
// ---------------------------------------------------------------------------

export function setBoostVoice(e: Engine, active: boolean): void {
  e.boost.gain.gain.setTargetAtTime(
    active ? BOOST_GAIN : 0,
    e.ctx.currentTime,
    VOICE_RAMP_TAU_S,
  );
}

export function setBrakeVoice(e: Engine, active: boolean): void {
  e.brake.gain.gain.setTargetAtTime(
    active ? BRAKE_GAIN : 0,
    e.ctx.currentTime,
    VOICE_RAMP_TAU_S,
  );
}

/** Maps intensity linearly to both gain and pitch (see ALARM_BASE_FREQ_HZ doc above for why pitch
 *  moves at all). Split evenly between the alarm's own gain and the LFO's scaling gain — their sum
 *  at the AudioParam is what the listener hears (see "Alarm tremolo" in the log for the algebra). */
export function setAlarmVoice(e: Engine, intensity: number): void {
  const clamped = Math.min(1, Math.max(0, intensity));
  const now = e.ctx.currentTime;
  const targetGain = clamped * ALARM_MAX_GAIN;
  const targetFreq =
    ALARM_BASE_FREQ_HZ + clamped * (ALARM_MAX_FREQ_HZ - ALARM_BASE_FREQ_HZ);
  e.alarm.gain.gain.setTargetAtTime(targetGain * 0.5, now, ALARM_RAMP_TAU_S);
  e.alarm.lfoGain.gain.setTargetAtTime(targetGain * 0.5, now, ALARM_RAMP_TAU_S);
  e.alarm.osc.frequency.setTargetAtTime(targetFreq, now, ALARM_RAMP_TAU_S);
}

export function setMasterMuted(e: Engine, muted: boolean): void {
  e.master.gain.setTargetAtTime(
    muted ? 0 : 1,
    e.ctx.currentTime,
    MUTE_RAMP_TAU_S,
  );
}
