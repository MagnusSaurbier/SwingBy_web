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
 * in practice follows a user gesture. `setMuted` and `setActive` deliberately do NOT trigger
 * construction: they are pure state setters that may be called at app boot before any gesture.
 *
 * Playback gate: in-game sound is only ever produced when ALL of these hold —
 *   1. the game loop is running (not paused) — driven by `setActive(status !== "paused")`,
 *   2. the tab is visible (`document.hidden === false`),
 *   3. the window has focus (`document.hasFocus()`).
 * The moment any of the three drops, the `AudioContext` is suspended: every voice and any
 * in-flight chime stops immediately. It resumes only once all three hold again. Visibility and
 * focus are observed here via `visibilitychange` + window `focus`/`blur`; condition 1 is the
 * caller's to report.
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
  /** Whether gameplay is live right now. The game loop passes `false` while paused and `true`
   *  otherwise. Combined (AND) with tab visibility and window focus to decide whether the
   *  AudioContext runs — see the module doc comment. A pure setter: never constructs the context. */
  setActive(active: boolean): void;
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

  // Playback gate — see module doc comment. All three must hold for sound to be produced.
  let active = true; // condition 1: game loop running (not paused). Set by setActive().
  let pageVisible =
    typeof document === "undefined"
      ? true
      : document.visibilityState !== "hidden";
  let pageFocused =
    typeof document === "undefined" || typeof document.hasFocus !== "function"
      ? true
      : document.hasFocus();

  /** Suspends or resumes the context so it runs only when all three gate conditions hold. No-op
   *  until the engine exists (the flags are applied when `ensureEngine` builds it). */
  function syncContextState(): void {
    if (destroyed || !engine) return;
    const ctx = engine.ctx;
    if (active && pageVisible && pageFocused) {
      void ctx.resume().catch(() => {
        // Autoplay policy can still block a resume outside a real gesture; nothing more to do.
      });
    } else {
      void ctx.suspend().catch(() => {});
    }
  }

  function ensureEngine(): Engine | null {
    if (destroyed) return null;
    if (engine) return engine;

    const Ctor = resolveAudioContextCtor();
    if (!Ctor) return null; // No WebAudio support anywhere — audio degrades to silence, never throws.

    const ctx = new Ctor();
    const built = buildEngine(ctx);
    built.master.gain.setValueAtTime(muted ? 0 : 1, ctx.currentTime);

    if (typeof document !== "undefined") {
      const onVisibility = (): void => {
        pageVisible = document.visibilityState !== "hidden";
        syncContextState();
      };
      const onFocus = (): void => {
        pageFocused = true;
        syncContextState();
      };
      const onBlur = (): void => {
        pageFocused = false;
        syncContextState();
      };
      document.addEventListener("visibilitychange", onVisibility);
      const w = typeof window !== "undefined" ? window : undefined;
      w?.addEventListener("focus", onFocus);
      w?.addEventListener("blur", onBlur);
      built.envCleanup = (): void => {
        document.removeEventListener("visibilitychange", onVisibility);
        w?.removeEventListener("focus", onFocus);
        w?.removeEventListener("blur", onBlur);
      };
    }

    engine = built;
    // Applies the current gate state — resumes if allowed (this call path is a user gesture),
    // suspends if the tab is already backgrounded/unfocused or the game isn't running.
    syncContextState();
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

    setActive(next: boolean): void {
      if (active === next) return;
      active = next;
      syncContextState(); // Deliberately does not construct the context — see module doc comment.
    },

    destroy(): void {
      destroyed = true;
      if (!engine) return;
      teardownEngine(engine);
      engine = null;
    },
  };
}
