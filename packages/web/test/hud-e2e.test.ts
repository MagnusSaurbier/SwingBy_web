/**
 * End-to-end check with the REAL `createSession` (the exported session, not the fake from
 * fake-session.ts — the fake is for unit tests only, the real session is for this one check).
 * Drives a synthetic, gravity-free level (see SOLVABLE_LEVEL — standing in for a real built-in
 * level + its solving tape, removed on feat/remove-gravity-softening; see
 * notes/feat-remove-gravity-softening/PLAN.md) through a real physics/replay/renderer stack to
 * completion, and confirms:
 *
 *   1. The HUD's live-computed final readout (`ticksToMs(elapsedTicks/boostTicks)`) is EXACTLY the
 *      same string as what the completion panel would show from `session.onComplete`'s payload —
 *      a HUD that displays a different time than the one submitted is the bug this check exists
 *      to catch.
 *   2. `verifyReplay` (the real implementation) ACCEPTS the recorded tape against the payload's
 *      claimed timeMs/boostMs, at zero tolerance.
 *
 * No jsdom/browser here (see notes/archive/T-09-GAUGE/log.md): `document` is my own fake DOM
 * (needed by `hud.ts`'s `document.createElement` calls), and
 * `requestAnimationFrame`/`cancelAnimationFrame` are stubbed to CAPTURE the callback rather than
 * auto-firing it — same technique `loop.test.ts` uses for its "createSession (real
 * requestAnimationFrame wrapper)" tests — so this test manually pumps frames at a synthetic
 * 144fps cadence instead of racing real rAF timing.
 * `createGameLoop`'s internal `createRenderer(canvas)` (T-04's real renderer) needs no `document`
 * at all, confirmed by T-05's own loop.test.ts running it with no document stub whatsoever — only
 * `hud.ts` needs one here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  inputAtTick,
  TPS,
  verifyReplay,
} from "@swingby/core";
import type {
  ControlAction,
  InputState,
  Level,
  ReplayTape,
} from "@swingby/core";
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
      const input = inputAtTick(
        tape,
        Math.min(tick, Math.max(tape.ticks - 1, 0)),
      );
      tick++;
      return input;
    },
    drainEvents: (): ControlAction[] => [],
    setBindings: () => {},
    attachTouch: () => {},
    destroy: () => {},
  };
}

/**
 * A synthetic, gravity-free level standing in for a real built-in level + its real T-03 solving
 * tape (removed on feat/remove-gravity-softening: physics.ts now implements pure inverse-square
 * gravity rather than the old softened form the real tape was recorded and timed under). Every
 * body has gravity 0, so the player's straight-line path to the goal is identical under any
 * gravity formula, keeping this fixture valid regardless of future physics changes.
 */
const SOLVABLE_LEVEL: Level = {
  name: "Solvable Fixture",
  author: "hud-e2e test fixture",
  goal: { index: 1, range: 15 },
  objects: [
    { type: "player", x: -300, y: 0, x_vel: 3, y_vel: 0, gravity: 0 },
    { type: "sun", x: 0, y: 0, gravity: 50, visible: true, size: 5 },
  ],
};

/** A tight (ticks = reachedTick + 1), goal-reaching, zero-input tape for SOLVABLE_LEVEL — the tick
 *  count is derived from `verifyReplay` itself, never hand-typed. */
function solvableTape(): ReplayTape {
  const loose: ReplayTape = { ticks: 500, boost: [], brake: [] };
  const probe = verifyReplay(SOLVABLE_LEVEL, loose, {
    timeMs: -1,
    boostMs: -1,
  });
  if (probe.reason === "no-goal" || probe.reason === "malformed") {
    throw new Error(
      `solvableTape: fixture never reached its goal (reason=${probe.reason})`,
    );
  }
  return { ticks: probe.ticks, boost: [], brake: [] };
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
    const level = SOLVABLE_LEVEL;
    const id = "synthetic-solvable";
    const tape = solvableTape();

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
    const frames = pumpFrames(
      () => session.snapshot().status === "complete",
      tape.ticks + 500,
    );

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
