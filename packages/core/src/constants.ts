/**
 * Simulation and gameplay constants.
 *
 * Values are load-bearing: all 33 built-in levels were hand-verified solvable
 * against exactly these numbers. Changing any of them invalidates every level
 * and every recorded score.
 */

// --- Simulation ------------------------------------------------------------

export const TPS = 144.0;
export const TICK_INTERVAL = 1.0 / TPS;
export const PHYSICS_SUBSTEPS = 4;
export const PHYSICS_SUBSTEPS_MAX = 12;

/** Adaptive substep triggers. */
export const MAX_GRAVITY_DV_PER_SUBSTEP = 0.045;
export const MIN_TRAVEL_RESOLUTION = 10.0;

/** Boost and brake rescale speed; they do not add a vector. See physics.ts. */
export const BOOST_STRENGTH = 0.005;
/** Currently 0.0 — WASD bindings exist but produce no acceleration. */
export const SIDE_THRUST = 0.0;

/** Softening radius floor and coefficients: max(14, src*1.15 + body*0.55 + 6). */
export const SOFTENING_MIN = 14.0;
export const SOFTENING_SOURCE_COEFF = 1.15;
export const SOFTENING_BODY_COEFF = 0.55;
export const SOFTENING_BIAS = 6.0;

/** Default when a level object omits `size`. */
export const DEFAULT_BODY_SIZE = 10.0;

// --- World bounds (rectangle, half-extents from origin) --------------------

export const MAX_WORLD_BOUNDS_X = 2600.0;
export const MAX_WORLD_BOUNDS_Y = 1800.0;
export const BOUNDS_WARNING_START_RATIO = 0.8;
export const BOUNDS_WARNING_DURATION = 0.65;
export const BOUNDS_WARNING_BORDER = 24.0;
export const RESET_FLASH_DURATION = 0.24;

// --- Trajectory prediction -------------------------------------------------

export const PREDICTION_TICKS = 1000;
export const PREDICTION_STRIDE = 5;

// --- Presentation ----------------------------------------------------------

export const ZOOM_SMOOTHING = 8.0;
export const ZOOM_IN_SMOOTHING = 20.0;
/** Fraction of the fit rect's own width/height added as margin on EACH side (so the padded rect
 *  is (1 + 2*FIT_MARGIN_RATIO)x the raw bounding box of player+suns+target). */
export const FIT_MARGIN_RATIO = 0.2;
/** Absolute floor (world units) on the fit rect's width/height, so a degenerate rect (a single
 *  relevant body, or all of them collapsed together) can't blow the zoom up unboundedly. */
export const MIN_FIT_SIZE = 100.0;
export const GOAL_RANGE_DEFAULT = 50.0;
export const TRAIL_LENGTH = 5000;
export const ROCKET_SCALE = 0.17;

// --- Palette (ported from GameConstants.gd, RGBA 0-1) ----------------------

export const COLORS = {
  sunCore: [1.0, 0.85, 0.45, 1.0],
  sunHalo: [1.0, 0.68, 0.21, 0.18],
  goal: [0.48, 0.96, 1.0, 0.82],
  trail: [0.58, 0.86, 1.0, 0.78],
  predictionPlayer: [0.97, 0.98, 1.0, 0.72],
  predictionPlanet: [0.48, 0.84, 1.0, 0.42],
  hudGlow: [0.62, 0.92, 1.0, 0.18],
} as const;

// --- Default settings ------------------------------------------------------

export const DEFAULT_CONTROLS = {
  boost: "Space",
  brake: "ShiftLeft",
  thrustUp: "KeyW",
  thrustDown: "KeyS",
  thrustLeft: "KeyA",
  thrustRight: "KeyD",
  restart: "KeyR",
  pause: "Backspace",
  menu: "Escape",
  toggleFps: "F1",
  toggleHighscores: "KeyH",
} as const;

export type ControlAction = keyof typeof DEFAULT_CONTROLS;

export const DEFAULT_SETTINGS = {
  username: "Guest",
  boostType: 0,
  trail: false,
  showFps: false,
  showHighscores: true,
  showTimes: true,
  showFuture: false,
  showForceVector: false,
  controls: DEFAULT_CONTROLS,
};

export type Settings = typeof DEFAULT_SETTINGS & {
  controls: Record<ControlAction, string>;
};
