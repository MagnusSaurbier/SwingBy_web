/**
 * T-01 KEPLER — parity suite: replays Godot-generated traces through physics.ts and
 * measures divergence.
 *
 * THE GATE THIS SUITE ENFORCES DOES NOT RUN YET. `traces/` is committed empty (see
 * traces/.gitkeep and README.md) because Godot is not available in the container this
 * suite was authored in, and inventing traces would make this file lie. When
 * `traces/level-*.json` exist, every `it()` below runs for real; until then, the whole
 * suite is dynamically SKIPPED (not passed) with a loud banner — see the `ctx.skip()`
 * call below. A vacuous green run here is exactly the failure mode this file is
 * designed against.
 *
 * Trace format is documented in ./README.md. Read that first if this file is
 * confusing.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Body, BodyType, InputState, Vec2, World } from "../../src/types.js";
import { predict, simulateTick } from "../../src/physics.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRACES_DIR = path.join(HERE, "traces");

// ---------------------------------------------------------------------------
// Canonical scripted input tape — MUST stay byte-identical to the copy in
// tools/godot-trace/trace.gd and the copy documented in README.md. Deliberately
// reimplemented here rather than imported from T-02's replay.ts: T-01 does not depend
// on another task's in-progress module (see PROJECT.md's parallel-work rules).
// ---------------------------------------------------------------------------

const BOOST_TRANSITIONS = [50, 150, 500, 650, 1200, 1350];
const BRAKE_TRANSITIONS = [700, 760, 1500, 1650];

function pressedAtTick(transitions: readonly number[], tick: number): boolean {
  let count = 0;
  for (const t of transitions) {
    if (t <= tick) count++;
    else break;
  }
  return count % 2 === 1;
}

function scriptedInputAtTick(tick: number): InputState {
  return {
    boost: pressedAtTick(BOOST_TRANSITIONS, tick),
    brake: pressedAtTick(BRAKE_TRANSITIONS, tick),
    thrustX: 0,
    thrustY: 0,
  };
}

const ZERO_INPUT: InputState = { boost: false, brake: false, thrustX: 0, thrustY: 0 };

// ---------------------------------------------------------------------------
// Trace JSON shapes (as documented in README.md) — kept local, not exported; this
// is a test-only concern.
// ---------------------------------------------------------------------------

interface TraceBodyJSON {
  type: BodyType;
  x: number;
  y: number;
  xVel: number;
  yVel: number;
  xAcc: number;
  yAcc: number;
  gravity: number;
  size: number;
  visible: boolean;
  anchored: boolean;
  isBoosting: boolean;
  isBraking: boolean;
  boostType: number;
}

interface SampleJSON {
  tick: number;
  bodies: TraceBodyJSON[];
}

interface RunJSON {
  totalTicks: number;
  sampleEveryTicks: number;
  samples: SampleJSON[];
  boostTransitions?: number[];
  brakeTransitions?: number[];
}

interface PredictionJSON {
  player: Vec2[];
  planets: Vec2[][];
}

interface TraceJSON {
  schemaVersion: number;
  levelIndex: number;
  levelName: string;
  goalIndex: number;
  goalRange: number;
  playerIndex: number;
  initialBodies: TraceBodyJSON[];
  zeroInput: RunJSON;
  scriptedInput: RunJSON;
  prediction: PredictionJSON;
  longRun?: RunJSON;
}

// ---------------------------------------------------------------------------
// Trace -> World reconstruction
// ---------------------------------------------------------------------------

/**
 * angle/turnSpeed are excluded from the trace schema entirely (see README.md, "Why
 * angle/turnSpeed are excluded") because Godot seeds turn_speed randomly per load and
 * no force calculation ever reads angle or turnSpeed back. Filling them with 0 here is
 * therefore provably inert to every position/velocity comparison this suite makes.
 */
function toBody(b: TraceBodyJSON): Body {
  return {
    type: b.type,
    x: b.x,
    y: b.y,
    xVel: b.xVel,
    yVel: b.yVel,
    xAcc: b.xAcc,
    yAcc: b.yAcc,
    gravity: b.gravity,
    size: b.size,
    visible: b.visible,
    anchored: b.anchored,
    angle: 0,
    turnSpeed: 0,
    isBoosting: b.isBoosting,
    isBraking: b.isBraking,
    boostType: b.boostType,
  };
}

function buildWorld(trace: TraceJSON): World {
  return {
    bodies: trace.initialBodies.map(toBody),
    playerIndex: trace.playerIndex,
    goalIndex: trace.goalIndex,
    goalRange: trace.goalRange,
  };
}

function maxPositionDivergence(actual: readonly Body[], expected: readonly TraceBodyJSON[]): number {
  let max = 0;
  const n = Math.min(actual.length, expected.length);
  for (let i = 0; i < n; i++) {
    const a = actual[i];
    const e = expected[i];
    if (a === undefined || e === undefined) continue;
    max = Math.max(max, Math.abs(a.x - e.x), Math.abs(a.y - e.y));
  }
  return max;
}

function maxVec2Divergence(actual: readonly Vec2[], expected: readonly Vec2[]): number {
  let max = 0;
  const n = Math.min(actual.length, expected.length);
  for (let i = 0; i < n; i++) {
    const a = actual[i];
    const e = expected[i];
    if (a === undefined || e === undefined) continue;
    max = Math.max(max, Math.abs(a.x - e.x), Math.abs(a.y - e.y));
  }
  return max;
}

/** Runs `world` forward tick-by-tick to each sample's tick, using `inputAt(tick)` for
 *  input, and returns the max position divergence seen across every sample. */
function replayAndMeasure(world: World, run: RunJSON, inputAt: (tick: number) => InputState): number {
  let maxDiv = 0;
  let firstBoostFired = false;
  let currentTick = 0;

  // Sample 0 is the pre-simulation baseline (tick 0) — must match exactly, since
  // it is purely a reconstruction check (no physics has run yet).
  const first = run.samples[0];
  if (first === undefined || first.tick !== 0) {
    throw new Error("malformed trace: run.samples[0] must be tick 0");
  }
  maxDiv = Math.max(maxDiv, maxPositionDivergence(world.bodies, first.bodies));

  for (let s = 1; s < run.samples.length; s++) {
    const sample = run.samples[s];
    if (sample === undefined) continue;
    while (currentTick < sample.tick) {
      const input = inputAt(currentTick);
      const result = simulateTick(world, input, { allowInput: true, firstBoostFired });
      if (result.firstBoostTriggered) firstBoostFired = true;
      currentTick++;
    }
    maxDiv = Math.max(maxDiv, maxPositionDivergence(world.bodies, sample.bodies));
  }

  return maxDiv;
}

// ---------------------------------------------------------------------------
// Trace discovery
// ---------------------------------------------------------------------------

function listTraceFiles(): string[] {
  if (!existsSync(TRACES_DIR)) return [];
  return readdirSync(TRACES_DIR)
    .filter((f) => /^level-\d{2}\.json$/.test(f))
    .sort();
}

function loadTrace(file: string): TraceJSON {
  const raw = readFileSync(path.join(TRACES_DIR, file), "utf8");
  return JSON.parse(raw) as TraceJSON;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const traceFiles = listTraceFiles();

describe("Godot parity (packages/core/test/parity/traces)", () => {
  if (traceFiles.length === 0) {
    it("SKIPPED — no Godot traces present, parity gate has not run", (ctx) => {
      // eslint-disable-next-line no-console
      console.warn(
        "\n" +
          "############################################################################\n" +
          "#  PARITY GATE DID NOT RUN.                                               #\n" +
          "#  packages/core/test/parity/traces/ contains no level-*.json files.      #\n" +
          "#  physics.ts has NOT been checked against the real Godot engine.         #\n" +
          "#  This is expected in a container without Godot installed — see          #\n" +
          "#  packages/core/test/parity/README.md for how to generate the traces     #\n" +
          "#  and results/T-01-KEPLER.md for full status.                            #\n" +
          "#  This test is SKIPPED, not passed — do not read a green run here as     #\n" +
          "#  parity proof.                                                          #\n" +
          "############################################################################\n",
      );
      ctx.skip();
    });
    return;
  }

  console.log(`Found ${traceFiles.length} trace file(s): ${traceFiles.join(", ")}`);

  for (const file of traceFiles) {
    const trace = loadTrace(file);

    describe(`${file} (${trace.levelName})`, () => {
      it(`zero-input divergence < 1e-6 world units over ${trace.zeroInput.totalTicks} ticks`, () => {
        const world = buildWorld(trace);
        const maxDiv = replayAndMeasure(world, trace.zeroInput, () => ZERO_INPUT);
        console.log(`  ${file} zeroInput max divergence: ${maxDiv.toExponential(3)}`);
        expect(maxDiv).toBeLessThan(1e-6);
      });

      it(`scripted boost/brake divergence < 1e-6 world units over ${trace.scriptedInput.totalTicks} ticks`, () => {
        const world = buildWorld(trace);
        const maxDiv = replayAndMeasure(world, trace.scriptedInput, scriptedInputAtTick);
        console.log(`  ${file} scriptedInput max divergence: ${maxDiv.toExponential(3)}`);
        expect(maxDiv).toBeLessThan(1e-6);
      });

      it("predict() matches recalculate_predictions sample-for-sample", () => {
        const world = buildWorld(trace);
        const prediction = predict(world);
        const playerDiv = maxVec2Divergence(prediction.player, trace.prediction.player);
        expect(prediction.player.length).toBe(trace.prediction.player.length);
        expect(prediction.planets.length).toBe(trace.prediction.planets.length);
        let planetDiv = 0;
        for (let i = 0; i < prediction.planets.length; i++) {
          const actualTrack = prediction.planets[i];
          const expectedTrack = trace.prediction.planets[i];
          if (actualTrack === undefined || expectedTrack === undefined) continue;
          expect(actualTrack.length).toBe(expectedTrack.length);
          planetDiv = Math.max(planetDiv, maxVec2Divergence(actualTrack, expectedTrack));
        }
        console.log(
          `  ${file} prediction max divergence: player ${playerDiv.toExponential(3)}, planets ${planetDiv.toExponential(3)}`,
        );
        expect(playerDiv).toBeLessThan(1e-6);
        expect(planetDiv).toBeLessThan(1e-6);
      });

      if (trace.longRun !== undefined) {
        it(`long-run drift < 1e-3 world units over ${trace.longRun.totalTicks} ticks`, () => {
          const world = buildWorld(trace);
          const longRun = trace.longRun;
          if (longRun === undefined) throw new Error("unreachable");
          const maxDiv = replayAndMeasure(world, longRun, () => ZERO_INPUT);
          console.log(`  ${file} longRun max divergence: ${maxDiv.toExponential(3)}`);
          expect(maxDiv).toBeLessThan(1e-3);
        });
      }
    });
  }
});
