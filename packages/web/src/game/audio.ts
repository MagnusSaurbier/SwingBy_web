/**
 * T-07 CHORUS — procedural WebAudio.
 *
 * Everything audible is synthesized at runtime with oscillators and gain nodes. No audio file of
 * any kind is imported, embedded, or fetched. See INTERFACES.md#webgameaudiots--t-07-chorus for the
 * frozen `AudioSink` contract and notes/T-07-CHORUS/log.md for the synthesis choices and why —
 * mostly ported from `reference/swift/AudioManager.swift` (the one exception in reference/swift/
 * that IS a reference for this port), with a few deliberate, logged deviations to satisfy this
 * task's own voice table.
 *
 * Hard constraint (autoplay policy): `createAudio()` below must not touch `AudioContext` at all.
 * The context is built lazily, the first time one of `setBoost` / `setBrake` / `setAlarm` / `chime`
 * is called — those are the four methods a caller only invokes in response to real gameplay, which
 * in practice follows a user gesture. `setMuted` deliberately does NOT trigger construction: it is a
 * pure settings setter that may be called at app boot before any gesture has happened.
 */

export interface AudioSink {
  setBoost(active: boolean): void;
  setBrake(active: boolean): void;
  /** 0-1, bounds proximity. Continuous — called every frame while near the bounds. */
  setAlarm(intensity: number): void;
  chime(kind: "levelStart" | "goal" | "reset" | "click"): void;
  setMuted(muted: boolean): void;
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Synthesis parameters — every number here is deliberate. See log for derivations.
// ---------------------------------------------------------------------------

/** Ambient drone: AudioManager.swift:19,76-83 — 60 Hz sine, constant low gain, always running. */
const AMBIENT_FREQ_HZ = 60;
const AMBIENT_GAIN = 0.04;
/** Soft fade-in the first time the engine starts, so the drone doesn't step in at full gain. */
const AMBIENT_FADE_IN_TAU_S = 0.5;

/** Boost: AudioManager.swift:85-94 — 220 Hz sine, gain 0↔0.25. */
const BOOST_FREQ_HZ = 220;
const BOOST_GAIN = 0.25;

/**
 * Brake: AudioManager.swift:96-105 — 140 Hz, gain 0↔0.25, same ramp speed as boost. Waveform
 * deliberately changed from sine to sawtooth (Swift is a plain sine like boost) to satisfy this
 * task's own Voices table ("Lower, rougher sustained tone") — see log, "dead end already ruled
 * out". Zero extra nodes; only `OscillatorNode.type` differs from a literal Swift port.
 */
const BRAKE_FREQ_HZ = 140;
const BRAKE_GAIN = 0.25;

/**
 * Boost/brake gain ramp time constant, derived from Swift's per-sample smoothing coefficient
 * (`gain += (target-gain) * ramp`, ramp=0.0005 @ sampleRate=44100 — AudioManager.swift:86,89-90,
 * 97,100-101). A per-sample multiplicative decay of (1-ramp) at sample period 1/sampleRate
 * corresponds to a continuous time constant `tau = -(1/sampleRate) / ln(1-ramp)`:
 *   ln(0.9995) ≈ -0.00050013  =>  tau ≈ 0.045341 s
 */
const VOICE_RAMP_TAU_S = 0.045;

/** Alarm: AudioManager.swift:107-119 — sine, tremolo LFO, gain = intensity * 0.3. */
const ALARM_MAX_GAIN = 0.3;
const ALARM_LFO_HZ = 3;
/**
 * Frequency is FIXED at 680 Hz in Swift; intensity only scales gain there. This task's Voices
 * table asks for "rises in pitch and volume as bounds approach", which Swift's alarm does not do —
 * deliberate deviation, logged. Range chosen to bracket Swift's 680 Hz center reasonably.
 */
const ALARM_BASE_FREQ_HZ = 500;
const ALARM_MAX_FREQ_HZ = 900;
/**
 * Alarm ramp time constant, same derivation as VOICE_RAMP_TAU_S but for Swift's alarm ramp=0.001
 * (AudioManager.swift:108,112): ln(0.999) ≈ -0.0010005 => tau ≈ 0.022665 s.
 */
const ALARM_RAMP_TAU_S = 0.023;

/** Mute ramp: fast enough to read as "immediate" (DoD: "Muting silences immediately") but still a
 *  ramp, never a direct assignment, so it can never itself produce a click. */
const MUTE_RAMP_TAU_S = 0.01;

interface ChimeTone {
  readonly freq: number;
  /** Present only for the frequency-sweeping "reset" cue. */
  readonly freqEnd?: number;
  readonly startOffset: number;
  readonly duration: number;
  readonly peakGain: number;
}

type ChimeKind = "levelStart" | "goal" | "reset" | "click";

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
const CHIME_DEFS: Readonly<Record<ChimeKind, readonly ChimeTone[]>> = {
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
// Engine — the lazily-constructed node graph. Built once per AudioSink, torn down on destroy().
// ---------------------------------------------------------------------------

interface Voice {
  readonly osc: OscillatorNode;
  readonly gain: GainNode;
}

interface AlarmVoice {
  readonly osc: OscillatorNode;
  readonly gain: GainNode;
  readonly lfoOsc: OscillatorNode;
  readonly lfoGain: GainNode;
}

interface ChimeVoice {
  readonly osc: OscillatorNode;
  readonly gain: GainNode;
}

interface Engine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly compressor: DynamicsCompressorNode;
  readonly ambient: Voice;
  readonly boost: Voice;
  readonly brake: Voice;
  readonly alarm: AlarmVoice;
  /** Transient per-chime nodes, tracked only so destroy() can stop/disconnect any still in flight. */
  readonly activeChimes: Set<ChimeVoice>;
  visibilityHandler: (() => void) | null;
}

/** Vendor-prefixed constructor Safari used before adopting the standard name. */
interface LegacyAudioContextWindow {
  webkitAudioContext?: typeof AudioContext;
}

function resolveAudioContextCtor(): (new () => AudioContext) | undefined {
  const g = globalThis as typeof globalThis & LegacyAudioContextWindow;
  return g.AudioContext ?? g.webkitAudioContext;
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

function buildEngine(ctx: AudioContext): Engine {
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
    visibilityHandler: null,
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

function teardown(e: Engine): void {
  if (e.visibilityHandler && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", e.visibilityHandler);
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

function playChime(e: Engine, kind: ChimeKind): void {
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
// Public factory
// ---------------------------------------------------------------------------

export function createAudio(): AudioSink {
  let engine: Engine | null = null;
  let muted = false;
  let destroyed = false;

  function ensureEngine(): Engine | null {
    if (destroyed) return null;
    if (engine) return engine;

    const Ctor = resolveAudioContextCtor();
    if (!Ctor) return null; // No WebAudio support anywhere — audio degrades to silence, never throws.

    const ctx = new Ctor();
    const built = buildEngine(ctx);
    built.master.gain.setValueAtTime(muted ? 0 : 1, ctx.currentTime);

    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {
        // Autoplay policy may still block this outside a real gesture; nothing more to do here.
      });
    }

    if (typeof document !== "undefined") {
      const handler = (): void => {
        if (destroyed) return;
        if (document.hidden) {
          void ctx.suspend().catch(() => {});
        } else {
          void ctx.resume().catch(() => {});
        }
      };
      document.addEventListener("visibilitychange", handler);
      built.visibilityHandler = handler;
    }

    engine = built;
    return built;
  }

  return {
    setBoost(active: boolean): void {
      const e = ensureEngine();
      if (!e) return;
      e.boost.gain.gain.setTargetAtTime(
        active ? BOOST_GAIN : 0,
        e.ctx.currentTime,
        VOICE_RAMP_TAU_S,
      );
    },

    setBrake(active: boolean): void {
      const e = ensureEngine();
      if (!e) return;
      e.brake.gain.gain.setTargetAtTime(
        active ? BRAKE_GAIN : 0,
        e.ctx.currentTime,
        VOICE_RAMP_TAU_S,
      );
    },

    setAlarm(intensity: number): void {
      const e = ensureEngine();
      if (!e) return;
      const clamped = Math.min(1, Math.max(0, intensity));
      const now = e.ctx.currentTime;
      const targetGain = clamped * ALARM_MAX_GAIN;
      const targetFreq =
        ALARM_BASE_FREQ_HZ + clamped * (ALARM_MAX_FREQ_HZ - ALARM_BASE_FREQ_HZ);
      // Split evenly between the alarm's own gain and the LFO's scaling gain — their sum at the
      // AudioParam is what the listener hears (see "Alarm tremolo" in the log).
      e.alarm.gain.gain.setTargetAtTime(
        targetGain * 0.5,
        now,
        ALARM_RAMP_TAU_S,
      );
      e.alarm.lfoGain.gain.setTargetAtTime(
        targetGain * 0.5,
        now,
        ALARM_RAMP_TAU_S,
      );
      e.alarm.osc.frequency.setTargetAtTime(targetFreq, now, ALARM_RAMP_TAU_S);
    },

    chime(kind: "levelStart" | "goal" | "reset" | "click"): void {
      const e = ensureEngine();
      if (!e) return;
      playChime(e, kind);
    },

    setMuted(next: boolean): void {
      muted = next;
      if (!engine) return; // Deliberately does not construct the context — see module doc comment.
      engine.master.gain.setTargetAtTime(
        muted ? 0 : 1,
        engine.ctx.currentTime,
        MUTE_RAMP_TAU_S,
      );
    },

    destroy(): void {
      destroyed = true;
      if (!engine) return;
      teardown(engine);
      engine = null;
    },
  };
}
