/**
 * T-09 GAUGE — end-to-end check with the REAL `createSession` (T-05's frozen export, not the fake
 * from fake-session.ts — hard rule 5 explicitly says the fake is for unit tests only, the real
 * session is for this one check). Drives a real built-in level, via its T-03-verified solvability
 * tape, through a real physics/replay/renderer stack to completion, and confirms:
 *
 *   1. The HUD's live-computed final readout (`ticksToMs(elapsedTicks/boostTicks)`) is EXACTLY the
 *      same string as what the completion panel would show from `session.onComplete`'s payload —
 *      "a HUD that displays a different time than the one submitted is the bug this check exists
 *      to catch" (task doc).
 *   2. `verifyReplay` (T-02's real implementation) ACCEPTS the recorded tape against the payload's
 *      claimed timeMs/boostMs, at zero tolerance.
 *
 * No jsdom/browser here (see notes/T-09-GAUGE/log.md): `document` is my own fake DOM (needed by
 * `hud.ts`'s `document.createElement` calls), and `requestAnimationFrame`/`cancelAnimationFrame`
 * are stubbed to CAPTURE the callback rather than auto-firing it — same technique T-05's own
 * `loop.test.ts` uses for its "createSession (real requestAnimationFrame wrapper)" tests — so this
 * test manually pumps frames at a synthetic 144fps cadence instead of racing real rAF timing.
 * `createGameLoop`'s internal `createRenderer(canvas)` (T-04's real renderer) needs no `document`
 * at all, confirmed by T-05's own loop.test.ts running it with no document stub whatsoever — only
 * `hud.ts` needs one here.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUILTIN_LEVELS,
  DEFAULT_SETTINGS,
  inputAtTick,
  levelId,
  TPS,
  verifyReplay,
} from "@swingby/core";
import type { ControlAction, InputState, ReplayTape } from "@swingby/core";
import { createSession, type CompletionPayload } from "../src/game/loop.js";
import type { InputSource } from "../src/game/input.js";
import type { AudioSink } from "../src/game/audio.js";
import { createFakeDom } from "../src/hud/__tests__/fakeDom.js";
import { mountHud } from "../src/hud/hud.js";
import { formatDuration, ticksToMs } from "../src/hud/format.js";

// ---------------------------------------------------------------------------
// Hand-rolled fixtures — NOT imported from T-04/T-05's own test infra, same "duplicate a small
// stub" precedent recorded throughout notes/T-09-GAUGE/log.md.
// ---------------------------------------------------------------------------

class FakeGradient {
  addColorStop(): void {}
}
class FakeCtx {
  fillStyle = "#000";
  strokeStyle = "#000";
  lineWidth = 1;
  lineCap = "butt";
  lineJoin = "miter";
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  fill(): void {}
  stroke(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  setTransform(): void {}
  drawImage(): void {}
  createRadialGradient(): FakeGradient {
    return new FakeGradient();
  }
}
function makeFakeCanvas(width = 800, height = 600): HTMLCanvasElement {
  const ctx = new FakeCtx();
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    style: { width: "", height: "" },
    getContext: (id: string) => (id === "2d" ? ctx : null),
  };
  return canvas as unknown as HTMLCanvasElement;
}

function makeAudioStub(): AudioSink {
  return {
    setBoost() {},
    setBrake() {},
    setAlarm() {},
    chime() {},
    setMuted() {},
    destroy() {},
  };
}

function makeTapeInputSource(tape: ReplayTape): InputSource {
  let tick = 0;
  return {
    poll(): InputState {
      const input = inputAtTick(tape, Math.min(tick, Math.max(tape.ticks - 1, 0)));
      tick++;
      return input;
    },
    drainEvents: (): ControlAction[] => [],
    setBindings: () => {},
    attachTouch: () => {},
    destroy: () => {},
  };
}

function loadSolvabilityTape(id: string): ReplayTape {
  const url = new URL(`../../core/test/level/solvability/tapes/${id}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as ReplayTape;
}

let fakeDoc: ReturnType<typeof createFakeDom>;
let scheduled: ((t: number) => void) | null = null;

beforeEach(() => {
  fakeDoc = createFakeDom();
  vi.stubGlobal("document", fakeDoc);
  scheduled = null;
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void): number => {
    scheduled = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", (): void => {
    scheduled = null;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const MS_PER_TICK = 1000 / TPS;

/** Manually pumps the real rAF-driven `createSession` at a synthetic, exact 144fps cadence
 *  (dt === TICK_INTERVAL every call after the first, which reports dt=0 per loop.ts's own
 *  `lastTimestamp === null` branch) until `predicate()` is true or `maxFrames` is exceeded. */
function pumpFrames(predicate: () => boolean, maxFrames: number): number {
  let t = 0;
  let frames = 0;
  while (!predicate() && frames < maxFrames) {
    const cb = scheduled;
    if (!cb) break;
    scheduled = null;
    t += MS_PER_TICK;
    cb(t);
    frames++;
  }
  return frames;
}

describe("end-to-end: real createSession + real hud.ts + real verifyReplay", () => {
  it("HUD's final live readout matches the completion payload exactly, and verifyReplay accepts the tape", () => {
    const level = BUILTIN_LEVELS[0]!;
    const id = levelId(0);
    expect(id).toBe("builtin-00");
    const tape = loadSolvabilityTape(id);

    const session = createSession({
      level,
      canvas: makeFakeCanvas(),
      input: makeTapeInputSource(tape),
      audio: makeAudioStub(),
      settings: DEFAULT_SETTINGS,
    });

    let lastLiveTimeText = "";
    let lastLiveBoostText = "";
    // Mirrors exactly what hud.ts computes for its live readout, using the SAME format.ts this
    // module ships — this is the "HUD's displayed time", captured on every snapshot regardless of
    // hud.ts's own internal throttling, so the LAST value captured before completion is guaranteed
    // to reflect the capturing tick (not stale by up to one throttle window).
    session.subscribe((snap) => {
      lastLiveTimeText = formatDuration(ticksToMs(snap.elapsedTicks));
      lastLiveBoostText = formatDuration(ticksToMs(snap.boostTicks));
    });

    const hud = mountHud({
      session,
      level,
      levelLabel: "Stage 01",
      levelKey: id,
      storage: { getSettings: () => DEFAULT_SETTINGS, getBest: () => null },
    });

    let completion: CompletionPayload | null = null;
    session.onComplete((r) => {
      completion = r;
    });

    session.start();
    const frames = pumpFrames(() => session.snapshot().status === "complete", tape.ticks + 500);

    expect(session.snapshot().status).toBe("complete");
    expect(completion).not.toBeNull();
    const payload = completion as unknown as CompletionPayload;

    // eslint-disable-next-line no-console
    console.log(
      `[hud-e2e] pumped ${frames} frames; elapsedTicks=${session.snapshot().elapsedTicks} ` +
        `payload.timeMs=${payload.timeMs} payload.boostMs=${payload.boostMs} ` +
        `hud-live-time="${lastLiveTimeText}" hud-live-boost="${lastLiveBoostText}"`,
    );

    // THE check: the HUD's own live-computed readout at the capturing tick, formatted through the
    // exact same format.ts the completion panel would use, must be identical to the payload.
    expect(lastLiveTimeText).toBe(formatDuration(payload.timeMs));
    expect(lastLiveBoostText).toBe(formatDuration(payload.boostMs));

    // verifyReplay: T-02's real implementation, zero tolerance.
    const result = verifyReplay(level, payload.tape, {
      timeMs: payload.timeMs,
      boostMs: payload.boostMs,
    });
    // eslint-disable-next-line no-console
    console.log(`[hud-e2e] verifyReplay: ${JSON.stringify(result)}`);
    expect(result.ok).toBe(true);
    expect(result.timeMs).toBe(payload.timeMs);
    expect(result.boostMs).toBe(payload.boostMs);

    hud.destroy();
  });
});
