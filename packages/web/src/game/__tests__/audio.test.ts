// T-07 CHORUS — unit tests for packages/web/src/game/audio.ts.
//
// There is no AudioContext in the plain-Node vitest environment this repo uses (same "no jsdom"
// stance as T-04/T-06/T-10 — see their logs). Per the task brief, this file hand-writes a small
// WebAudio double — FakeAudioContext/FakeOscillatorNode/FakeGainNode/FakeAudioParam — installed
// onto `globalThis.AudioContext` per test, mirroring how storage.test.ts swaps
// `globalThis.localStorage` (packages/web/src/storage/__tests__/storage.test.ts:27-37). This
// exercises the real node-graph, ramp, and lifecycle logic in audio.ts without a browser.
//
// One documented simplification: FakeOscillatorNode.stop() records the stop but does NOT fire its
// own `onended` — real WebAudio fires `ended` asynchronously, some time after `stop()` is called,
// once playback actually reaches the scheduled time. The fake has no real clock, so a test that
// wants to simulate "the browser eventually fired ended" calls `.triggerEnded()` explicitly. This
// lets the test suite tell apart two different code paths that would otherwise look identical:
// (a) a chime that finished naturally (ended fired, its own handler cleaned it up) vs.
// (b) a chime destroy() catches still in flight (ended never fired, teardown's own loop must be
//     the thing that disconnects it). See notes/T-07-CHORUS/log.md.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAudio, type AudioSink } from "../audio.js";

// ---------------------------------------------------------------------------------------------
// Fake WebAudio double
// ---------------------------------------------------------------------------------------------

interface AutomationEvent {
  type: "setValueAtTime" | "linearRampToValueAtTime" | "setTargetAtTime";
  value: number;
  time: number;
  constant?: number;
}

/** Records every automation call AND counts direct `.value =` assignments separately, so a test
 *  can prove "this param was only ever ramped, never assigned" — the DoD's "no clicks or pops"
 *  requirement, made mechanically checkable. */
class FakeAudioParam {
  private _value = 0;
  directSetCount = 0;
  events: AutomationEvent[] = [];

  get value(): number {
    return this._value;
  }
  set value(v: number) {
    this._value = v;
    this.directSetCount++;
  }

  setValueAtTime(value: number, time: number): this {
    this._value = value;
    this.events.push({ type: "setValueAtTime", value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this._value = value;
    this.events.push({ type: "linearRampToValueAtTime", value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number, constant: number): this {
    this._value = value;
    this.events.push({ type: "setTargetAtTime", value, time, constant });
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

class FakeAudioNode {
  connections: FakeAudioNode[] = [];
  paramConnections: FakeAudioParam[] = [];
  connected = true;

  connect(
    dest: FakeAudioNode | FakeAudioParam,
  ): FakeAudioNode | FakeAudioParam {
    if (dest instanceof FakeAudioParam) {
      this.paramConnections.push(dest);
    } else {
      this.connections.push(dest);
    }
    return dest;
  }
  disconnect(): void {
    this.connections = [];
    this.paramConnections = [];
    this.connected = false;
  }
}

class FakeOscillatorNode extends FakeAudioNode {
  type: OscillatorType = "sine";
  frequency = new FakeAudioParam();
  started = false;
  stopped = false;
  startTime: number | undefined;
  stopTime: number | undefined;
  onended: (() => void) | null = null;

  start(when = 0): void {
    if (this.started)
      throw new Error("FakeOscillatorNode: cannot call start more than once");
    this.started = true;
    this.startTime = when;
  }
  stop(when = 0): void {
    this.stopped = true;
    this.stopTime = when;
    // Does NOT fire onended — see file header. Call triggerEnded() to simulate that.
  }
  /** Simulates the browser eventually delivering the real, asynchronous `ended` event. */
  triggerEnded(): void {
    if (this.onended) this.onended();
  }
}

class FakeGainNode extends FakeAudioNode {
  gain = new FakeAudioParam();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  currentTime = 0;
  state: "suspended" | "running" | "closed" = "suspended";
  destination = new FakeAudioNode();
  oscillators: FakeOscillatorNode[] = [];
  gains: FakeGainNode[] = [];
  compressors: FakeAudioNode[] = [];

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createOscillator(): FakeOscillatorNode {
    const o = new FakeOscillatorNode();
    this.oscillators.push(o);
    return o;
  }
  createGain(): FakeGainNode {
    const g = new FakeGainNode();
    this.gains.push(g);
    return g;
  }
  createDynamicsCompressor(): FakeAudioNode {
    const c = new FakeAudioNode();
    this.compressors.push(c);
    return c;
  }
  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = "suspended";
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }

  /** Oscillators that have been start()ed but not yet stop()ed — the "is anything leaking" gauge. */
  liveOscillatorCount(): number {
    return this.oscillators.filter((o) => o.started && !o.stopped).length;
  }
}

// ---------------------------------------------------------------------------------------------
// Install/remove the fake global, exactly like storage.test.ts does for localStorage.
// ---------------------------------------------------------------------------------------------

let originalDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "AudioContext",
  );
  Object.defineProperty(globalThis, "AudioContext", {
    value: FakeAudioContext,
    configurable: true,
    writable: true,
  });
  FakeAudioContext.instances = [];
});

afterEach(() => {
  if (originalDescriptor) {
    Object.defineProperty(globalThis, "AudioContext", originalDescriptor);
  } else {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
  }
});

function ctx(index = 0): FakeAudioContext {
  const c = FakeAudioContext.instances[index];
  if (!c)
    throw new Error(`expected FakeAudioContext.instances[${index}] to exist`);
  return c;
}

// ---------------------------------------------------------------------------------------------
// 1. Lazy construction — the autoplay-policy requirement, mechanically proven.
// ---------------------------------------------------------------------------------------------

describe("lazy AudioContext construction", () => {
  it("createAudio() alone constructs no AudioContext", () => {
    createAudio();
    expect(FakeAudioContext.instances.length).toBe(0);
  });

  it("setMuted() alone constructs no AudioContext (pure state setter, may run before any gesture)", () => {
    const sink = createAudio();
    sink.setMuted(true);
    sink.setMuted(false);
    expect(FakeAudioContext.instances.length).toBe(0);
  });

  it("setBoost() constructs exactly one AudioContext, lazily", () => {
    const sink = createAudio();
    expect(FakeAudioContext.instances.length).toBe(0);
    sink.setBoost(true);
    expect(FakeAudioContext.instances.length).toBe(1);
    sink.setBoost(false);
    sink.setBoost(true);
    expect(FakeAudioContext.instances.length).toBe(1); // still just one — reused, not rebuilt
  });

  it("setBrake() triggers construction", () => {
    const sink = createAudio();
    sink.setBrake(true);
    expect(FakeAudioContext.instances.length).toBe(1);
  });

  it("setAlarm() triggers construction", () => {
    const sink = createAudio();
    sink.setAlarm(0.4);
    expect(FakeAudioContext.instances.length).toBe(1);
  });

  it("chime() triggers construction", () => {
    const sink = createAudio();
    sink.chime("click");
    expect(FakeAudioContext.instances.length).toBe(1);
  });

  it("a muted flag set before construction is applied at construction time (no click, nothing audible yet)", () => {
    const sink = createAudio();
    sink.setMuted(true);
    sink.setBoost(true); // first real use — builds the engine
    const c = ctx();
    const master = c.gains[0]!; // master gain is the first GainNode created, see buildEngine()
    expect(master.gain.events[0]).toMatchObject({
      type: "setValueAtTime",
      value: 0,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Graph shape — persistent voices created once, with the documented synthesis parameters.
// ---------------------------------------------------------------------------------------------

describe("persistent voice graph", () => {
  let sink: AudioSink;

  beforeEach(() => {
    sink = createAudio();
    sink.setBoost(true); // any real-use call constructs the full graph, not just the boost voice
  });

  it("creates exactly 5 persistent oscillators: ambient, boost, brake, alarm, alarm-LFO", () => {
    expect(ctx().oscillators.length).toBe(5);
    expect(ctx().oscillators.every((o) => o.started)).toBe(true);
  });

  it("creates exactly 6 persistent gain nodes: master, ambient, boost, brake, alarm, alarm-LFO", () => {
    expect(ctx().gains.length).toBe(6);
  });

  it("creates exactly 1 DynamicsCompressorNode (clipping safety net, not present in Swift)", () => {
    expect(ctx().compressors.length).toBe(1);
  });

  it("assigns the measured waveform + frequency for each persistent voice", () => {
    const [ambient, boost, brake, alarm, lfo] = ctx().oscillators as [
      FakeOscillatorNode,
      FakeOscillatorNode,
      FakeOscillatorNode,
      FakeOscillatorNode,
      FakeOscillatorNode,
    ];
    expect(ambient.type).toBe("sine");
    expect(ambient.frequency.value).toBe(60);
    expect(boost.type).toBe("sine");
    expect(boost.frequency.value).toBe(220);
    expect(brake.type).toBe("sawtooth"); // deliberate deviation from Swift's sine — see log
    expect(brake.frequency.value).toBe(140);
    expect(alarm.type).toBe("sine");
    expect(alarm.frequency.value).toBe(500); // base frequency before any setAlarm() call
    expect(lfo.type).toBe("sine");
    expect(lfo.frequency.value).toBe(3);
  });

  it("no persistent oscillator is ever started more than once, across many setBoost/setBrake/setAlarm calls", () => {
    for (let i = 0; i < 50; i++) {
      sink.setBoost(i % 2 === 0);
      sink.setBrake(i % 3 === 0);
      sink.setAlarm((i % 10) / 10);
    }
    // FakeOscillatorNode.start() throws on a second call, so reaching here at all is the proof;
    // also assert the node COUNT never grew (this is the "no per-event allocation" DoD item).
    expect(ctx().oscillators.length).toBe(5);
    expect(ctx().gains.length).toBe(6);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. No clicks or pops — every gain is ramped, never assigned, under heavy rapid toggling.
// ---------------------------------------------------------------------------------------------

describe("ramped gains, never assigned (click/pop prevention)", () => {
  it("rapid boost toggling (100 calls, faster than the DoD's '10+ times per second') never assigns .gain.value directly", () => {
    const sink = createAudio();
    for (let i = 0; i < 100; i++) {
      sink.setBoost(i % 2 === 0);
    }
    const c = ctx();
    for (const g of c.gains) {
      expect(g.gain.directSetCount).toBe(0);
    }
    // And the ramps actually happened — not a no-op.
    const boostGain = c.gains[2]!; // master, ambient, boost, brake, alarm, lfo — see buildEngine()
    const ramps = boostGain.gain.events.filter(
      (e) => e.type === "setTargetAtTime",
    );
    expect(ramps.length).toBeGreaterThanOrEqual(100);
    expect(ramps.every((e) => e.constant === 0.045)).toBe(true); // VOICE_RAMP_TAU_S, measured
  });

  it("rapid brake toggling never assigns .gain.value directly either", () => {
    const sink = createAudio();
    for (let i = 0; i < 100; i++) {
      sink.setBrake(i % 2 === 1);
    }
    for (const g of ctx().gains) {
      expect(g.gain.directSetCount).toBe(0);
    }
  });

  it("setAlarm sweeping 0..1 across 100 calls never assigns any gain or frequency directly", () => {
    const sink = createAudio();
    for (let i = 0; i <= 100; i++) {
      sink.setAlarm(i / 100);
    }
    for (const g of ctx().gains) {
      expect(g.gain.directSetCount).toBe(0);
    }
    const alarmOsc = ctx().oscillators[3]!; // ambient, boost, brake, alarm, lfo
    // Frequency IS assigned once directly, at graph construction (base value, silent at t=0);
    // every subsequent change from setAlarm() must be a ramp, not another direct assignment.
    expect(alarmOsc.frequency.directSetCount).toBe(1);
    expect(
      alarmOsc.frequency.events.filter((e) => e.type === "setTargetAtTime")
        .length,
    ).toBeGreaterThanOrEqual(101);
  });

  it("constant-pitch voices (ambient/boost/brake) set frequency exactly once, at construction, and never again", () => {
    const sink = createAudio();
    sink.setBoost(true);
    sink.setBoost(false);
    sink.setBrake(true);
    sink.setBrake(false);
    const [ambient, boost, brake] = ctx().oscillators as [
      FakeOscillatorNode,
      FakeOscillatorNode,
      FakeOscillatorNode,
    ];
    expect(ambient.frequency.directSetCount).toBe(1);
    expect(boost.frequency.directSetCount).toBe(1);
    expect(brake.frequency.directSetCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// 4. setAlarm — continuous mapping, clamped, cheap/idempotent.
// ---------------------------------------------------------------------------------------------

describe("setAlarm(intensity)", () => {
  it("maps intensity linearly to gain (0..0.3) and frequency (500..900 Hz), split gain 50/50 across alarm+LFO gain", () => {
    const sink = createAudio();
    sink.setAlarm(1);
    const alarmGain = ctx().gains[4]!; // master, ambient, boost, brake, alarm, lfo
    const lfoGain = ctx().gains[5]!;
    const alarmOsc = ctx().oscillators[3]!;
    expect(alarmGain.gain.value).toBeCloseTo(0.15, 10); // 1 * 0.3 * 0.5
    expect(lfoGain.gain.value).toBeCloseTo(0.15, 10);
    expect(alarmOsc.frequency.value).toBeCloseTo(900, 10);
  });

  it("clamps out-of-range intensity to [0,1]", () => {
    const sink = createAudio();
    sink.setAlarm(-5);
    const alarmGainLow = ctx().gains[4]!;
    expect(alarmGainLow.gain.value).toBe(0);

    sink.setAlarm(999);
    expect(alarmGainLow.gain.value).toBeCloseTo(0.15, 10);
  });

  it("is idempotent and cheap: repeating the same intensity allocates no new nodes", () => {
    const sink = createAudio();
    sink.setAlarm(0.5);
    const before = { osc: ctx().oscillators.length, gain: ctx().gains.length };
    for (let i = 0; i < 200; i++) sink.setAlarm(0.5);
    expect(ctx().oscillators.length).toBe(before.osc);
    expect(ctx().gains.length).toBe(before.gain);
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Chimes — one-shot voices, per-kind synthesis parameters.
// ---------------------------------------------------------------------------------------------

describe("chime(kind)", () => {
  it("levelStart: single 880 Hz tone, 0.15 s, peak gain 0.3", () => {
    const sink = createAudio();
    sink.setMuted(false);
    sink.chime("levelStart"); // first real use — builds the graph too
    const c = ctx();
    const persistentCount = 5;
    expect(c.oscillators.length).toBe(persistentCount + 1);
    const tone = c.oscillators[persistentCount]!;
    expect(tone.frequency.events[0]).toMatchObject({
      type: "setValueAtTime",
      value: 880,
    });
    expect(tone.stopTime).toBeCloseTo(0.15 + 0.02, 10);
  });

  it("goal: 3-tone C5/E5/G5 triad staggered 0.14 s apart, 0.12 s each", () => {
    const sink = createAudio();
    sink.chime("goal");
    const c = ctx();
    const tones = c.oscillators.slice(5); // after the 5 persistent voices
    expect(tones.length).toBe(3);
    const freqs = tones.map((t) => t.frequency.events[0]!.value);
    expect(freqs).toEqual([523, 659, 784]);
    const starts = tones.map((t) => t.startTime);
    expect(starts).toEqual([0, 0.14, 0.28]);
    for (const t of tones) {
      expect(t.stopTime).toBeCloseTo((t.startTime ?? 0) + 0.12 + 0.02, 10);
    }
  });

  it("reset: 300→150 Hz linear sweep over 0.4 s, peak gain 0.25", () => {
    const sink = createAudio();
    sink.chime("reset");
    const tone = ctx().oscillators[5]!;
    expect(tone.frequency.events[0]).toMatchObject({
      type: "setValueAtTime",
      value: 300,
    });
    const sweep = tone.frequency.events.find(
      (e) => e.type === "linearRampToValueAtTime",
    );
    expect(sweep).toMatchObject({ value: 150 });
    expect(tone.stopTime).toBeCloseTo(0.4 + 0.02, 10);
  });

  it("click: single 1200 Hz tone, 0.03 s, peak gain 0.3", () => {
    const sink = createAudio();
    sink.chime("click");
    const tone = ctx().oscillators[5]!;
    expect(tone.frequency.events[0]).toMatchObject({
      type: "setValueAtTime",
      value: 1200,
    });
    expect(tone.stopTime).toBeCloseTo(0.03 + 0.02, 10);
  });

  it("every chime's gain envelope attacks then decays to exactly 0 (no hard stop discontinuity)", () => {
    const sink = createAudio();
    sink.chime("click");
    const toneGain = ctx().gains[6]!; // 6 persistent gains, then this chime's own
    const events = toneGain.gain.events;
    expect(events[0]).toMatchObject({ type: "setValueAtTime", value: 0 });
    expect(events[1]!.type).toBe("linearRampToValueAtTime");
    expect(events[1]!.value).toBeGreaterThan(0);
    expect(events[events.length - 1]).toMatchObject({
      type: "linearRampToValueAtTime",
      value: 0,
    });
  });

  it("chime nodes are transient: scheduled to stop immediately, and cleaned up (disconnected) once the browser's `ended` event actually fires", () => {
    const sink = createAudio();
    sink.chime("click");
    const tone = ctx().oscillators[5]!;
    const toneGain = ctx().gains[6]!;
    // stop() was already called (scheduling it), but nothing is disconnected yet — real WebAudio
    // doesn't disconnect until `ended` actually fires, which the fake models as a separate step.
    expect(tone.stopped).toBe(true);
    expect(tone.connected).toBe(true);

    tone.triggerEnded(); // simulate the browser delivering the real, asynchronous `ended` event

    expect(tone.connected).toBe(false);
    expect(toneGain.connected).toBe(false);
  });

  it("a chime never grows the persistent voice count", () => {
    const sink = createAudio();
    sink.chime("goal");
    sink.chime("levelStart");
    sink.chime("reset");
    sink.chime("click");
    // Only the persistent 5 remain "live" (started && !stopped) — every chime oscillator stops itself.
    expect(ctx().liveOscillatorCount()).toBe(5);
  });
});

// ---------------------------------------------------------------------------------------------
// 6. setMuted — immediate (fast-ramped), never a hard assignment.
// ---------------------------------------------------------------------------------------------

describe("setMuted", () => {
  it("ramps the master gain to 0 on mute and back to 1 on unmute, never assigning .value directly", () => {
    const sink = createAudio();
    sink.setBoost(true); // construct
    const master = ctx().gains[0]!;
    const before = master.gain.directSetCount;

    sink.setMuted(true);
    expect(master.gain.value).toBe(0);
    sink.setMuted(false);
    expect(master.gain.value).toBe(1);

    expect(master.gain.directSetCount).toBe(before); // unchanged — both mute transitions were ramps
    const ramps = master.gain.events.filter(
      (e) => e.type === "setTargetAtTime",
    );
    expect(ramps.length).toBeGreaterThanOrEqual(2);
    expect(ramps.every((e) => e.constant === 0.01)).toBe(true); // MUTE_RAMP_TAU_S, measured
  });
});

// ---------------------------------------------------------------------------------------------
// 7. Teardown — the leak-proofing requirements.
// ---------------------------------------------------------------------------------------------

describe("destroy()", () => {
  it("stops every persistent oscillator, disconnects every node, and closes the context", () => {
    const sink = createAudio();
    sink.setBoost(true);
    sink.setBrake(true);
    sink.setAlarm(0.7);
    const c = ctx();
    expect(c.liveOscillatorCount()).toBeGreaterThan(0);

    sink.destroy();

    expect(c.liveOscillatorCount()).toBe(0);
    expect(c.oscillators.every((o) => !o.connected)).toBe(true);
    expect(c.gains.every((g) => !g.connected)).toBe(true);
    expect(c.state).toBe("closed");
  });

  it("disconnects chimes still awaiting their asynchronous 'ended' event, not just ones that already fired it", () => {
    const sink = createAudio();
    sink.chime("goal"); // 3 transient tones — stop() scheduled, but `ended` deliberately not fired
    const tones = ctx().oscillators.slice(5);
    expect(tones).toHaveLength(3);
    expect(tones.every((t) => t.connected)).toBe(true); // still connected — genuinely "in flight"

    sink.destroy(); // must sweep e.activeChimes itself; nothing will ever fire `ended` for these now

    expect(tones.every((t) => !t.connected)).toBe(true);
    expect(
      ctx()
        .gains.slice(6)
        .every((g) => !g.connected),
    ).toBe(true);
  });

  it("is a safe no-op when called before any real use ever constructed a context", () => {
    const sink = createAudio();
    expect(() => sink.destroy()).not.toThrow();
    expect(FakeAudioContext.instances.length).toBe(0);
  });

  it("is idempotent: calling destroy() twice does not throw or double-close", () => {
    const sink = createAudio();
    sink.setBoost(true);
    sink.destroy();
    expect(() => sink.destroy()).not.toThrow();
  });

  it("after destroy(), further calls are silent no-ops and construct no new context", () => {
    const sink = createAudio();
    sink.setBoost(true);
    sink.destroy();
    sink.setBoost(true);
    sink.setBrake(true);
    sink.setAlarm(1);
    sink.chime("click");
    sink.setMuted(true);
    expect(FakeAudioContext.instances.length).toBe(1); // still just the one, now-closed, context
  });

  it("N create/destroy cycles (20, per the DoD's 'no too many contexts warning after 20 restarts') leave zero running oscillators and every context closed", () => {
    const N = 20;
    for (let i = 0; i < N; i++) {
      const sink = createAudio();
      sink.setBoost(true);
      sink.setBrake(true);
      sink.setAlarm(0.3);
      sink.chime("levelStart");
      sink.destroy();
    }
    expect(FakeAudioContext.instances.length).toBe(N);
    const totalLive = FakeAudioContext.instances.reduce(
      (sum, c) => sum + c.liveOscillatorCount(),
      0,
    );
    expect(totalLive).toBe(0);
    expect(FakeAudioContext.instances.every((c) => c.state === "closed")).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// 8. Graceful degradation — no AudioContext support anywhere must never throw.
// ---------------------------------------------------------------------------------------------

describe("no WebAudio support", () => {
  it("every method is a silent no-op when neither AudioContext nor webkitAudioContext exists", () => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    const sink = createAudio();
    expect(() => {
      sink.setBoost(true);
      sink.setBrake(true);
      sink.setAlarm(0.5);
      sink.chime("goal");
      sink.setMuted(true);
      sink.destroy();
    }).not.toThrow();
    expect(FakeAudioContext.instances.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 9. Playback gate — sound is produced only while the game runs AND the tab is visible AND the
//    window is focused. Any one dropping suspends the context; all three must hold to resume.
// ---------------------------------------------------------------------------------------------

/** Minimal document/window doubles: just enough of the event-target + visibility/focus surface
 *  `audio.ts` reads. Installed onto globalThis for the duration of a test, same idiom as the
 *  AudioContext fake above. */
class FakeEventTarget {
  listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, cb: () => void): void {
    (
      this.listeners.get(type) ?? this.listeners.set(type, new Set()).get(type)!
    ).add(cb);
  }
  removeEventListener(type: string, cb: () => void): void {
    this.listeners.get(type)?.delete(cb);
  }
  emit(type: string): void {
    for (const cb of [...(this.listeners.get(type) ?? [])]) cb();
  }
  listenerCount(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}

class FakeDocument extends FakeEventTarget {
  visibilityState: "visible" | "hidden" = "visible";
  focused = true;
  get hidden(): boolean {
    return this.visibilityState === "hidden";
  }
  hasFocus(): boolean {
    return this.focused;
  }
}

describe("playback gate (running + visible + focused)", () => {
  let fakeDoc: FakeDocument;
  let fakeWin: FakeEventTarget;
  const saved: Record<string, PropertyDescriptor | undefined> = {};

  function install(name: string, value: unknown): void {
    saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
  }

  beforeEach(() => {
    fakeDoc = new FakeDocument();
    fakeWin = new FakeEventTarget();
    install("document", fakeDoc);
    install("window", fakeWin);
  });

  afterEach(() => {
    for (const name of ["document", "window"]) {
      if (saved[name]) Object.defineProperty(globalThis, name, saved[name]!);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  });

  it("setActive(false) suspends the context; setActive(true) resumes it", () => {
    const sink = createAudio();
    sink.setBoost(true); // build engine — resumes (all three conditions hold)
    expect(ctx().state).toBe("running");

    sink.setActive(false);
    expect(ctx().state).toBe("suspended");

    sink.setActive(true);
    expect(ctx().state).toBe("running");
  });

  it("window blur suspends, focus resumes", () => {
    const sink = createAudio();
    sink.setBoost(true);
    expect(ctx().state).toBe("running");

    fakeDoc.focused = false;
    fakeWin.emit("blur");
    expect(ctx().state).toBe("suspended");

    fakeDoc.focused = true;
    fakeWin.emit("focus");
    expect(ctx().state).toBe("running");
  });

  it("tab becoming hidden suspends, becoming visible resumes", () => {
    const sink = createAudio();
    sink.setBoost(true);

    fakeDoc.visibilityState = "hidden";
    fakeDoc.emit("visibilitychange");
    expect(ctx().state).toBe("suspended");

    fakeDoc.visibilityState = "visible";
    fakeDoc.emit("visibilitychange");
    expect(ctx().state).toBe("running");
  });

  it("all three must hold: a paused game stays silent when the tab regains focus", () => {
    const sink = createAudio();
    sink.setBoost(true);

    sink.setActive(false); // paused
    fakeDoc.focused = false;
    fakeWin.emit("blur");
    expect(ctx().state).toBe("suspended");

    fakeDoc.focused = true;
    fakeWin.emit("focus"); // focus back, but still paused
    expect(ctx().state).toBe("suspended");

    sink.setActive(true); // now all three hold
    expect(ctx().state).toBe("running");
  });

  it("if the engine is built while the window is unfocused, it starts suspended", () => {
    fakeDoc.focused = false;
    const sink = createAudio();
    sink.setBoost(true);
    expect(ctx().state).toBe("suspended");
  });

  it("setActive alone never constructs an AudioContext", () => {
    const sink = createAudio();
    sink.setActive(false);
    sink.setActive(true);
    expect(FakeAudioContext.instances.length).toBe(0);
  });

  it("destroy() removes the visibility/focus/blur listeners", () => {
    const sink = createAudio();
    sink.setBoost(true);
    expect(fakeDoc.listenerCount() + fakeWin.listenerCount()).toBeGreaterThan(
      0,
    );
    sink.destroy();
    expect(fakeDoc.listenerCount() + fakeWin.listenerCount()).toBe(0);
  });
});
