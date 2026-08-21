/**
 * T-07 CHORUS — procedural WebAudio, public surface.
 *
 * Everything audible is synthesized at runtime with oscillators and gain nodes. No audio file of
 * any kind is imported, embedded, or fetched. See docs/INTERFACES.md for the `AudioSink` contract.
 * This file owns WHEN sound happens: the lazy-construction contract (autoplay policy) and the
 * public `AudioSink` methods. HOW each voice sounds — every frequency, gain, ramp time constant,
 * and chime envelope — lives in `./audio-voices.ts`. See notes/archive/T-07-CHORUS/log.md for the
 * design reasoning.
 *
 * Hard constraint (autoplay policy): `createAudio()` below must not touch `AudioContext` at all.
 * The context is built lazily, the first time one of `setBoost` / `setBrake` / `setAlarm` / `chime`
 * is called — those are the four methods a caller only invokes in response to real gameplay, which
 * in practice follows a user gesture. `setMuted` deliberately does NOT trigger construction: it is a
 * pure settings setter that may be called at app boot before any gesture has happened.
 */

import {
  buildEngine,
  teardownEngine,
  playChime,
  setBoostVoice,
  setBrakeVoice,
  setAlarmVoice,
  setMasterMuted,
  type Engine,
} from "./audio-voices.js";

export interface AudioSink {
  setBoost(active: boolean): void;
  setBrake(active: boolean): void;
  /** 0-1, bounds proximity. Continuous — called every frame while near the bounds. */
  setAlarm(intensity: number): void;
  chime(kind: "levelStart" | "goal" | "reset" | "click"): void;
  setMuted(muted: boolean): void;
  destroy(): void;
}

/** Vendor-prefixed constructor Safari used before adopting the standard name. */
interface LegacyAudioContextWindow {
  webkitAudioContext?: typeof AudioContext;
}

function resolveAudioContextCtor(): (new () => AudioContext) | undefined {
  const g = globalThis as typeof globalThis & LegacyAudioContextWindow;
  return g.AudioContext ?? g.webkitAudioContext;
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
      setBoostVoice(e, active);
    },

    setBrake(active: boolean): void {
      const e = ensureEngine();
      if (!e) return;
      setBrakeVoice(e, active);
    },

    setAlarm(intensity: number): void {
      const e = ensureEngine();
      if (!e) return;
      setAlarmVoice(e, intensity);
    },

    chime(kind: "levelStart" | "goal" | "reset" | "click"): void {
      const e = ensureEngine();
      if (!e) return;
      playChime(e, kind);
    },

    setMuted(next: boolean): void {
      muted = next;
      if (!engine) return; // Deliberately does not construct the context — see module doc comment.
      setMasterMuted(engine, muted);
    },

    destroy(): void {
      destroyed = true;
      if (!engine) return;
      teardownEngine(engine);
      engine = null;
    },
  };
}
