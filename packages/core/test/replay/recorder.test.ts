/**
 * T-02 TAPE — `TapeRecorder` and `inputAtTick`.
 *
 * `inputAtTick` must be O(log n) (binary search) and must agree with a naive linear
 * "replay every transition in order" expansion at every tick, for every generated tape — DoD
 * item in tasks/T-02-TAPE.md.
 */

import { describe, expect, it } from "vitest";

import { TapeRecorder, inputAtTick } from "../../src/replay.js";
import type { InputState, ReplayTape } from "../../src/types.js";
import { genTapes } from "./fixtures.js";

// ---------------------------------------------------------------------------
// TapeRecorder
// ---------------------------------------------------------------------------

function inputOf(boost: boolean, brake: boolean): InputState {
  return { boost, brake, thrustX: 0, thrustY: 0 };
}

describe("TapeRecorder", () => {
  it("records nothing for a run with no input at all", () => {
    const rec = new TapeRecorder();
    for (let t = 0; t < 100; t++) rec.record(t, inputOf(false, false));
    const tape = rec.finish(100);
    expect(tape).toEqual({ ticks: 100, boost: [], brake: [] });
  });

  it("records a transition only when the control's held state actually changes", () => {
    const rec = new TapeRecorder();
    // boost held ticks 10..19 (released at 20), brake never pressed.
    for (let t = 0; t < 30; t++) {
      rec.record(t, inputOf(t >= 10 && t < 20, false));
    }
    const tape = rec.finish(30);
    expect(tape).toEqual({ ticks: 30, boost: [10, 20], brake: [] });
  });

  it("an odd-length array means the control was still held at the final recorded tick", () => {
    const rec = new TapeRecorder();
    for (let t = 0; t < 15; t++) rec.record(t, inputOf(t >= 5, false));
    const tape = rec.finish(15);
    expect(tape.boost).toEqual([5]); // pressed at 5, never released
    expect(tape.boost.length % 2).toBe(1);
  });

  it("tracks boost and brake independently, interleaved", () => {
    const rec = new TapeRecorder();
    const pattern: Array<[boolean, boolean]> = [
      [false, false], // 0
      [true, false], // 1 boost on
      [true, true], // 2 brake on
      [false, true], // 3 boost off
      [false, false], // 4 brake off
    ];
    pattern.forEach(([boost, brake], t) =>
      rec.record(t, inputOf(boost, brake)),
    );
    const tape = rec.finish(5);
    expect(tape.boost).toEqual([1, 3]);
    expect(tape.brake).toEqual([2, 4]);
  });

  it("round-trips through inputAtTick: replaying a recording reproduces the same input sequence", () => {
    const rec = new TapeRecorder();
    const script: Array<[boolean, boolean]> = [];
    for (let t = 0; t < 200; t++) {
      const boost = Math.floor(t / 17) % 2 === 0;
      const brake = Math.floor(t / 23) % 2 === 1;
      script.push([boost, brake]);
      rec.record(t, inputOf(boost, brake));
    }
    const tape = rec.finish(200);
    for (let t = 0; t < 200; t++) {
      const got = inputAtTick(tape, t);
      expect([got.boost, got.brake]).toEqual(script[t]);
    }
  });
});

// ---------------------------------------------------------------------------
// inputAtTick — correctness vs. a naive linear expansion, across generated + real tapes.
// ---------------------------------------------------------------------------

/** The same "flip on every transition <= tick" logic T-03's solvability runner duplicated
 *  (test/level/solvability/run.test.ts:34-41) — reimplemented locally (not imported; that file is
 *  T-03's, and per the file-ownership rule we don't import across `test/level/**`). This is the
 *  naive O(n) reference `inputAtTick` is checked against. */
function naiveHeldAtTick(
  transitions: readonly number[],
  tick: number,
): boolean {
  let held = false;
  for (const t of transitions) {
    if (t > tick) break;
    held = !held;
  }
  return held;
}

function naiveInputAtTick(tape: ReplayTape, tick: number): InputState {
  return {
    boost: naiveHeldAtTick(tape.boost, tick),
    brake: naiveHeldAtTick(tape.brake, tick),
    thrustX: 0,
    thrustY: 0,
  };
}

describe("inputAtTick agrees with naive per-tick expansion", () => {
  const generated = genTapes(100, 0xc0ffee, {
    maxTicks: 2000,
    maxTransitionsPerControl: 30,
  });

  it(`across ${generated.length} generated tapes, at every tick`, () => {
    let checked = 0;
    for (const tape of generated) {
      for (let tick = 0; tick < tape.ticks; tick++) {
        const got = inputAtTick(tape, tick);
        const want = naiveInputAtTick(tape, tick);
        expect(got.boost, `tick ${tick} boost, ticks=${tape.ticks}`).toBe(
          want.boost,
        );
        expect(got.brake, `tick ${tick} brake, ticks=${tape.ticks}`).toBe(
          want.brake,
        );
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    console.log(
      `inputAtTick agreement: ${checked} tick-lookups across ${generated.length} generated tapes, 0 mismatches`,
    );
  }, 20000);

  it("agrees at tick 0 and at the tape's last tick (boundary cases)", () => {
    const tape: ReplayTape = { ticks: 50, boost: [0, 10], brake: [49] };
    expect(inputAtTick(tape, 0)).toEqual({
      boost: true,
      brake: false,
      thrustX: 0,
      thrustY: 0,
    });
    expect(inputAtTick(tape, 9)).toEqual({
      boost: true,
      brake: false,
      thrustX: 0,
      thrustY: 0,
    });
    expect(inputAtTick(tape, 10)).toEqual({
      boost: false,
      brake: false,
      thrustX: 0,
      thrustY: 0,
    });
    expect(inputAtTick(tape, 49)).toEqual({
      boost: false,
      brake: true,
      thrustX: 0,
      thrustY: 0,
    });
  });

  it("an empty tape holds nothing at any tick", () => {
    const tape: ReplayTape = { ticks: 0, boost: [], brake: [] };
    expect(inputAtTick(tape, 0)).toEqual({
      boost: false,
      brake: false,
      thrustX: 0,
      thrustY: 0,
    });
  });
});
