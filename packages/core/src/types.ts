/**
 * FROZEN CONTRACT — do not change without updating INTERFACES.md and notifying all task owners.
 *
 * Two representations exist and must not be confused:
 *
 *   LevelObject  snake_case, matches SwingBy2026/data/levels_builtin.json byte-for-byte.
 *                Persisted format. Never mutated at runtime.
 *   Body         camelCase, fully populated (no optional fields). Runtime simulation state.
 *
 * `hydrate()` in level.ts is the only bridge between them (task T-03 ATLAS).
 */

// ---------------------------------------------------------------------------
// Persisted level format (snake_case — matches the existing JSON exactly)
// ---------------------------------------------------------------------------

export type BodyType = "player" | "sun" | "planet";

export interface LevelObject {
  type: BodyType;
  x: number;
  y: number;
  /** Absent on suns in some levels; treat as 0. */
  x_vel?: number;
  y_vel?: number;
  /** Gravitational parameter, NOT mass. Sources with gravity === 0 are skipped entirely. */
  gravity: number;
  /** Render + softening radius. Defaults to 10 when absent. */
  size?: number;
  /** Suns only. false = invisible but still gravitating. Defaults to true. */
  visible?: boolean;
  /** Planets only. Anchored bodies never integrate. Defaults to false. */
  anchored?: boolean;
  /** Planets only. Degrees per tick of visual spin. Defaults to 0. */
  turn_speed?: number;
  /** Player only. Selects the rocket sprite variant, 0-3. Defaults to 0. */
  boost_type?: number;
}

export interface LevelGoal {
  /** Index into Level.objects of the body that must be reached. -1 means "no target set yet" —
   *  always valid except when `validate()` is called with `{ requireGoal: true }` (level share). */
  index: number;
  /** Capture radius in world units. */
  range: number;
}

export interface Level {
  name: string;
  author: string;
  goal: LevelGoal;
  objects: LevelObject[];
}

// ---------------------------------------------------------------------------
// Runtime simulation state (camelCase, no optionals)
// ---------------------------------------------------------------------------

export interface Body {
  type: BodyType;
  x: number;
  y: number;
  xVel: number;
  yVel: number;
  /** Accumulated per substep, zeroed at the start of each substep. */
  xAcc: number;
  yAcc: number;
  gravity: number;
  size: number;
  visible: boolean;
  anchored: boolean;
  /** Visual rotation in radians. Not read by physics. */
  angle: number;
  /** Degrees per tick, converted to radians inside the integrator. */
  turnSpeed: number;
  isBoosting: boolean;
  isBraking: boolean;
  boostType: number;
}

export interface World {
  bodies: Body[];
  /** Index into bodies of the player. Guaranteed to exist post-hydrate. */
  playerIndex: number;
  /** Index into bodies of the goal body, or -1 if no target is set (see LevelGoal.index). */
  goalIndex: number;
  goalRange: number;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface InputState {
  boost: boolean;
  brake: boolean;
  /**
   * Directional thrust, each in [-1, 1]. Currently multiplied by SIDE_THRUST,
   * which is 0.0 — so these have no effect on the simulation today. Kept in the
   * contract because the bindings exist and may be enabled. See T-06 HELM.
   */
  thrustX: number;
  thrustY: number;
}

export const NO_INPUT: InputState = Object.freeze({
  boost: false,
  brake: false,
  thrustX: 0,
  thrustY: 0,
});

// ---------------------------------------------------------------------------
// Simulation results
// ---------------------------------------------------------------------------

export interface TickResult {
  /** True if boost, brake, or directional thrust was applied this tick. */
  thrusting: boolean;
  /** True only on the tick the very first boost of an attempt fires. */
  firstBoostTriggered: boolean;
  /** True once the player is within goalRange of the goal body. */
  reachedGoal: boolean;
  /** True once the player is outside MAX_WORLD_BOUNDS. */
  outOfBounds: boolean;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Prediction {
  /** Sampled player positions, PREDICTION_STRIDE ticks apart. */
  player: Vec2[];
  /** One sampled track per planet, in body order. */
  planets: Vec2[][];
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/**
 * Run-length encoded input. `boost` and `brake` hold the tick indices at which
 * that control CHANGED STATE, starting from released. So [10, 25] means held
 * from tick 10 up to but not including tick 25.
 */
export interface ReplayTape {
  /** Total ticks simulated. */
  ticks: number;
  boost: number[];
  brake: number[];
}

export interface VerifyResult {
  ok: boolean;
  /** Populated when ok === false. */
  reason?: "no-goal" | "out-of-bounds" | "time-mismatch" | "boost-mismatch" | "malformed";
  /** Simulated values, for comparison against the client's claim. */
  timeMs: number;
  boostMs: number;
  ticks: number;
}
