# SwingBy Web — module map and interfaces

_Read this when your task needs to know which module owns what, or the exact shape of a
function/type it depends on. Shared types live in
[`packages/core/src/types.ts`](../packages/core/src/types.ts) and constants in
[`packages/core/src/constants.ts`](../packages/core/src/constants.ts) — read them before writing
code against anything below; they are the vocabulary for everything here._

Signatures below are the actual current contracts. If you change one, update this file in the
same commit — see AGENTS.md.

---

## Module map

| Path                                                      | What lives here                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `packages/core/src/types.ts`, `constants.ts`              | Shared type contract and simulation/gameplay constants                                      |
| `packages/core/src/physics.ts`                            | Physics core — see [docs/PHYSICS.md](PHYSICS.md)                                            |
| `packages/core/test/physics-regression/**`                | Physics regression suite (self-consistency + orbit-stability checks, no external reference) |
| `packages/core/src/replay.ts`                             | Replay tape encoding/decoding/verification                                                  |
| `packages/core/src/level.ts`, `levels.json`               | Level loading, validation, the 33 built-in levels                                           |
| `packages/web/src/render/**`                              | Canvas renderer                                                                             |
| `packages/web/src/game/loop.ts`, `camera.ts`, `bounds.ts` | Game loop, camera, world bounds                                                             |
| `packages/web/src/game/input.ts`                          | Keyboard, touch, gamepad input + rebinding                                                  |
| `packages/web/src/game/audio.ts`                          | Procedural WebAudio                                                                         |
| `packages/web/src/ui/**`                                  | Menu, level select, settings, workshop                                                      |
| `packages/web/src/hud/**`                                 | In-game HUD, pause, level complete, toasts                                                  |
| `packages/web/src/storage/**`                             | Local persistence                                                                           |
| `packages/web/src/editor/**`                              | Level editor                                                                                |
| `packages/web/src/net/**`                                 | Leaderboard + sharing client                                                                |
| `api/**`, `infra/schema.sql`                              | Backend API + schema                                                                        |
| `infra/**` (except `schema.sql`), `vercel.json`, CI       | Deploy config, CI                                                                           |

---

## `core/physics.ts`

```ts
import type { Body, World, InputState, TickResult, Prediction } from "./types";

/** Adaptive substep count for the current state. Clamped to [PHYSICS_SUBSTEPS, PHYSICS_SUBSTEPS_MAX]. */
export function substepCount(bodies: readonly Body[]): number;

/** Accumulates attraction of `source` into body.xAcc/yAcc. No-op if source.gravity === 0. */
export function applyGravityAcceleration(body: Body, source: Body): void;

/**
 * Advances the world by exactly one tick (all substeps). Mutates world.bodies in place.
 * `firstBoostFired` is the caller's running flag; pass it in and honour the returned
 * firstBoostTriggered to update it.
 */
export function simulateTick(
  world: World,
  input: InputState,
  opts: { allowInput: boolean; firstBoostFired: boolean },
): TickResult;

/** Forward simulation with no input, for the trajectory overlay. Never mutates `world`. */
export function predict(world: World): Prediction;

/**
 * Visual rotation for the player ship, from its velocity. `atan2(yVel, xVel) + PI/2`,
 * or 0 when `xVel² + yVel² <= 1e-6`. Cosmetic — nothing in the physics path reads
 * `angle` back.
 */
export function rocketAngleFromVelocity(xVel: number, yVel: number): number;
```

> **Watch for interface gaps like this one:** `rocketAngleFromVelocity` was implemented but, for a
> while, missing from this document. Because the omission was in the contract rather than in
> anyone's code, the renderer kept rotating the ship by `Body.angle`, `simulateTick` only ever
> advanced `angle` for planets, and nothing set the player's — so the rocket flew curving
> trajectories while pointing in a fixed direction. A function existing in `physics.ts` but not
> documented here is exactly the kind of gap that produces a bug nobody's code is individually
> wrong about.
>
> Called by the game loop once per tick, **not from inside `simulateTick`**. Consumers that drive
> `simulateTick` directly rather than through the loop (e.g. `verifyReplay`) do not set `angle`,
> which is correct: it is not part of the simulation.

**Behavioural notes that are easy to get wrong:**

- **Boost and brake rescale the speed; they do not add a vector.** Boost computes
  `share = (speed + BOOST_STRENGTH * stepScale) / speed` and multiplies both velocity components by
  it. Brake uses `max(0, speed - step) / speed`. When `speed === 0`, boost adds `step` to `xVel`
  only. Getting this wrong changes every trajectory subtly and will pass a casual eyeball test.
- Suns and anchored bodies **never integrate** — skip them entirely in the body loop.
- Acceleration is zeroed per body at the **start of each substep**, not per tick.
- Integration is semi-implicit Euler: velocity updates from acceleration, then position from the
  **new** velocity, both scaled by `stepScale = 1 / substeps`.
- Planet `angle += degToRad(turnSpeed) * stepScale` is visual only; physics ignores it.
- Sources with `gravity === 0` are skipped, both in `substepCount` and in the force loop.
- `predict()` shortens its horizon with crowding: `PREDICTION_TICKS`, then `*2/3` above 4 moving
  bodies, then `/2` above 6. Planet sampling stride doubles above 2 planets.

---

## `core/replay.ts`

```ts
import type { InputState, Level, ReplayTape, VerifyResult } from "./types";

/** Records per-tick input into transition-index form. */
export class TapeRecorder {
  record(tick: number, input: InputState): void;
  finish(totalTicks: number): ReplayTape;
}

/** Reconstructs the input state at a given tick. O(log n). */
export function inputAtTick(tape: ReplayTape, tick: number): InputState;

/** Replays a tape against a level and reports what actually happened. Pure, node-safe. */
export function verifyReplay(
  level: Level,
  tape: ReplayTape,
  claim: { timeMs: number; boostMs: number },
  tolerance?: { timeMs?: number; boostMs?: number },
): VerifyResult;

export function encodeTape(tape: ReplayTape): string; // URL-safe, compact
export function decodeTape(encoded: string): ReplayTape;
```

Tapes must stay small: a 60-second run is 8,640 ticks but only tens of transitions. Reject tapes
with more than 2,000 transitions or `ticks > 144 * 600` as malformed.

---

## `core/level.ts`

```ts
import type { Level, LevelObject, World } from "./types";

export const BUILTIN_LEVELS: readonly Level[];

/** Persisted → runtime. Fills every default; throws LevelError if invalid. */
export function hydrate(level: Level): World;

/** Runtime → persisted. Round-trips: serialize(hydrate(l)) deep-equals l. */
export function serialize(
  world: World,
  meta: { name: string; author: string },
): Level;

export function validate(
  level: Level,
  opts?: { requireGoal?: boolean },
): { ok: true } | { ok: false; errors: string[] };

export function levelId(index: number): string; // stable id for scores/URLs

/**
 * Stable id for a CUSTOM level. `Level` has no `id` field and the persisted custom-levels
 * store is a bare array, so the id must be derived from content. See "Custom level ids" below.
 */
export function customLevelId(level: Level): string;
```

### Custom level ids — a gap in the frozen types, resolved here

`Level` deliberately mirrors the persisted JSON shape, which carries **no id**. But deleting a
custom level, share links, and the editor's save flow all need a stable handle for a custom level.

**Canonical rule:** derive it deterministically from content —
`slug(name) + "-" + djb2(JSON.stringify(level))`. `level.ts` owns `customLevelId()` and exports it;
everyone else imports it rather than reimplementing.

Note the consequence: **renaming or editing a custom level changes its id.** That is acceptable for
local storage and unlisted share links (a new version is a new link), but it means ids are not
durable identity — do not use one as a database primary key that must survive an edit. The backend
mints its own independent slug for shared levels precisely for this reason.

Validation rules: exactly one player object; `goal.index` either -1 ("no target set", always
allowed unless `opts.requireGoal`) or in range and not the player; `goal.range > 0`; every object
has finite coordinates. No rule requires a gravity source — a level may have none.

---

## `web/render/index.ts`

```ts
import type { World, Vec2, Prediction } from "@swingby/core/types";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface RenderFrame {
  world: World;
  camera: Camera;
  trail: readonly Vec2[];
  prediction: Prediction | null;
  forceVector: Vec2 | null;
  boundsWarning: number; // 0-1, drives the edge glow
  flash: number; // 0-1, reset flash
  showTrail: boolean;
  backgroundFit?: { width: number; height: number }; // starfield wrap-tile size; see starfield.ts
  editorOverlay?: unknown; // opaque to the renderer; the editor defines it
}

export interface Renderer {
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  draw(frame: RenderFrame): void;
  /** World↔screen for hit-testing. Used by the editor. */
  worldToScreen(p: Vec2, camera: Camera): Vec2;
  screenToWorld(p: Vec2, camera: Camera): Vec2;
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer;
```

The renderer is **stateless with respect to gameplay** — it draws exactly what the frame says and
owns no simulation state. It must tolerate `world` mutating between frames.

---

## `web/game/loop.ts`

```ts
export type GameStatus = "playing" | "paused" | "complete" | "resetting";

export interface GameSnapshot {
  status: GameStatus;
  elapsedTicks: number;
  boostTicks: number;
  fps: number;
  boundsWarning: number;
  reachedGoal: boolean;
}

export interface GameSession {
  start(): void;
  pause(): void;
  resume(): void;
  restart(): void;
  destroy(): void;
  snapshot(): GameSnapshot;
  /** Fires once on capture, with the tape for submission. */
  onComplete(
    cb: (r: { timeMs: number; boostMs: number; tape: ReplayTape }) => void,
  ): void;
  subscribe(cb: (s: GameSnapshot) => void): () => void;
}

export function createSession(opts: {
  level: Level;
  canvas: HTMLCanvasElement;
  input: InputSource;
  audio: AudioSink;
  settings: Settings;
}): GameSession;
```

Fixed-timestep accumulator at `TICK_INTERVAL`, capped at 8 ticks per frame to avoid spiral-of-death
after a tab is backgrounded. Rendering is decoupled and runs once per rAF.

---

## `web/game/input.ts`

```ts
import type { InputState, ControlAction } from "@swingby/core";

export interface InputSource {
  /** Sampled once per tick by the loop. Must be cheap. */
  poll(): InputState;
  /** Edge-triggered actions (restart, pause, menu, toggles). Drains the queue. */
  drainEvents(): ControlAction[];
  setBindings(bindings: Record<ControlAction, string>): void;
  attachTouch(zones: { boost: DOMRect; brake: DOMRect }): void;
  destroy(): void;
}

export function createInputSource(target: HTMLElement): InputSource;
```

Bindings are `KeyboardEvent.code` strings, not `key` — layout-independent.

---

## `web/game/audio.ts`

```ts
export interface AudioSink {
  setBoost(active: boolean): void;
  setBrake(active: boolean): void;
  setAlarm(intensity: number): void; // 0-1, bounds proximity
  chime(kind: "levelStart" | "goal" | "reset" | "click"): void;
  setMuted(muted: boolean): void;
  destroy(): void;
}

export function createAudio(): AudioSink;
```

All sound synthesized at runtime — **no audio files ship**. `createAudio()` must not construct an
`AudioContext` until the first user gesture, or autoplay policy will block it.

---

## `web/storage/index.ts`

```ts
import type { Level, Settings } from "@swingby/core";

export interface PersonalBest {
  timeMs: number;
  boostMs: number;
}

export interface Storage {
  getSettings(): Settings;
  setSettings(patch: Partial<Settings>): void;
  getBest(levelId: string): PersonalBest | null;
  recordBest(
    levelId: string,
    r: PersonalBest,
  ): { timeIsNew: boolean; boostIsNew: boolean };
  listCustomLevels(): Level[];
  saveCustomLevel(level: Level): void;
  deleteCustomLevel(id: string): void;
  export(): string; // full JSON backup
  import(json: string): void;
}

export function createStorage(): Storage;
```

Must migrate cleanly from an empty store, and must never throw on corrupt data — reset to defaults
and keep going.

### Settings keys that live outside the frozen `Settings` type

| Key               | Type     | Owner       | Accessors                                                             |
| ----------------- | -------- | ----------- | --------------------------------------------------------------------- |
| `editLevelHotkey` | `string` | `web/ui/**` | `readEditLevelHotkey` / `editLevelHotkeyPatch` in `ui/view-models.ts` |

`Settings` is derived from `DEFAULT_SETTINGS` in `packages/core/src/constants.ts`, which is
frozen — that, and nothing else, is why this key is not declared there. It is a real, persisted
settings field; it is simply invisible to the type.

It survives because `createStorage`'s `mergeSettings`, `setSettings` and `import()` each preserve
unknown fields deliberately, and `export()` serialises the whole settings object. **Do not "tidy up"
any of those three into a known-keys allowlist** — that would silently discard this key, with no
type error anywhere to catch it. `packages/web/test/edit-current-level.test.ts` covers the full
`export()` → `import()` path for exactly that reason.

Read and write it only through the two accessors above, so the cast that bridges the type gap lives
in one place.

### Browser storage key namespace: `swingby:`

**Every key any package writes into `localStorage` or `sessionStorage` must be prefixed
`swingby:`.** The keys that exist today:

| Key                     | Written by                               |
| ----------------------- | ---------------------------------------- |
| `swingby:settings`      | `web/storage/index.ts`                   |
| `swingby:bests`         | `web/storage/index.ts`                   |
| `swingby:custom_levels` | `web/storage/index.ts`                   |
| `swingby:score_queue`   | `web/net/queue.ts` (`QUEUE_STORAGE_KEY`) |

The convention is load-bearing, not cosmetic. Settings' "Delete all local data"
(`web/ui/localData.ts`) wipes by **prefix sweep**, not by a hard-coded list, so it keeps working when
a new key is added without anyone touching that button; and the same sweep is what lets it leave
keys belonging to other apps on the origin alone. A new key outside the namespace would silently
survive a wipe that promises the user everything is gone.

There are no cookies, no IndexedDB and no service worker in this app, deliberately. If you introduce
one, say so in your PR: those substrates are outside the sweep and the button's promise would need
widening. `packages/web/test/delete-local-data.test.ts` asserts the convention against the source of
both persisting modules.

---

## `api`

```
GET  /api/leaderboard?level=<id>&metric=fastest|efficient&limit=50
     → { entries: [{ rank, name, timeMs, boostMs, verified, createdAt }] }

POST /api/score
     { levelId, metric, timeMs, boostMs, name, tape }
     → { accepted: boolean, verified: boolean, rank?: number, reason?: string }

GET  /api/levels?sort=new|top&limit=20      → { levels: [{ id, name, author, plays }] }
GET  /api/levels/:id                        → { id, name, author, data }
POST /api/levels  { name, author, data }    → { id }
```

`POST /api/score` **must** call `verifyReplay` server-side before writing with `verified: true`.
Unverifiable submissions may be stored with `verified: false` but must never outrank verified ones.

---

## `web/net/index.ts`

```ts
export interface LeaderboardEntry {
  rank: number;
  name: string;
  timeMs: number;
  boostMs: number;
  verified: boolean;
}

export interface Api {
  leaderboard(
    levelId: string,
    metric: "fastest" | "efficient",
  ): Promise<LeaderboardEntry[]>;
  submitScore(s: {
    levelId: string;
    metric: string;
    timeMs: number;
    boostMs: number;
    name: string;
    tape: ReplayTape;
  }): Promise<{ accepted: boolean; rank?: number }>;
  shareLevel(level: Level): Promise<{ id: string; url: string }>;
  fetchLevel(id: string): Promise<Level>;
}

export function createApi(baseUrl: string): Api;
```

Every method must degrade gracefully: the game stays fully playable with the API unreachable. Never
block a level start or completion on a network call.
