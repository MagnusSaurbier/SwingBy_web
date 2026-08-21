# SwingBy Web — Frozen Interfaces

*Every signature here is a contract between tasks. Implement against these exactly. Changing one
requires updating this file and notifying every consuming task — never change a shared signature
unilaterally.*

Shared types live in [`packages/core/src/types.ts`](packages/core/src/types.ts) and constants in
[`packages/core/src/constants.ts`](packages/core/src/constants.ts). Both are already written and
frozen. Read them before starting; they are the vocabulary for everything below.

---

## File ownership

No two tasks write the same file. If you need a change in a file you do not own, request it.

| Path | Owner |
|---|---|
| `packages/core/src/types.ts`, `constants.ts` | **frozen — nobody** |
| `packages/core/src/physics.ts` | T-01 KEPLER |
| `packages/core/test/parity/**` | T-01 KEPLER |
| `packages/core/src/replay.ts` | T-02 TAPE |
| `packages/core/src/level.ts`, `levels.json` | T-03 ATLAS |
| `packages/web/src/render/**` | T-04 AURORA |
| `packages/web/src/game/loop.ts`, `camera.ts`, `bounds.ts` | T-05 FLYWHEEL |
| `packages/web/src/game/input.ts` | T-06 HELM |
| `packages/web/src/game/audio.ts` | T-07 CHORUS |
| `packages/web/src/ui/**` | T-08 BRIDGE |
| `packages/web/src/hud/**` | T-09 GAUGE |
| `packages/web/src/storage/**` | T-10 VAULT |
| `packages/web/src/editor/**` | T-11 DRAFT |
| `packages/web/src/net/**` | T-13 PODIUM |
| `api/**`, `infra/schema.sql` | T-12 LEDGER |
| `infra/**` (except schema.sql), `vercel.json`, CI | T-14 LAUNCHPAD |

---

## `core/physics.ts` — T-01 KEPLER

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
 * `angle` back, and the parity traces exclude it.
 */
export function rocketAngleFromVelocity(xVel: number, yVel: number): number;
```

> **Added after the original freeze** (additive, nothing existing changed). `rocket_angle_from_velocity`
> exists in `PhysicsEngine.gd:215-218` but was omitted from the five functions listed here, so it was
> never ported — and because the omission was in the contract rather than in anyone's code, every task
> was individually correct. The renderer rotated the ship by `Body.angle`, `simulateTick` only advances
> `angle` for planets, and nothing set the player's, so the rocket flew curving trajectories while
> pointing in a fixed direction.
>
> **Called by T-05 FLYWHEEL's loop, once per tick, not from `simulateTick`** — matching where Godot
> calls it (`GameWorld.gd:551`, after the tick, not inside `PhysicsEngine`). Consumers that drive
> `simulateTick` directly rather than through the loop (e.g. `verifyReplay`) do not set `angle`, which
> is correct: it is not part of the simulation.

**Behavioural notes that are easy to get wrong** — all verified against `PhysicsEngine.gd`:

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

## `core/replay.ts` — T-02 TAPE

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

export function encodeTape(tape: ReplayTape): string;   // URL-safe, compact
export function decodeTape(encoded: string): ReplayTape;
```

Tapes must stay small: a 60-second run is 8,640 ticks but only tens of transitions. Reject tapes
with more than 2,000 transitions or `ticks > 144 * 600` as malformed.

---

## `core/level.ts` — T-03 ATLAS

```ts
import type { Level, LevelObject, World } from "./types";

export const BUILTIN_LEVELS: readonly Level[];

/** Persisted → runtime. Fills every default; throws LevelError if invalid. */
export function hydrate(level: Level): World;

/** Runtime → persisted. Round-trips: serialize(hydrate(l)) deep-equals l. */
export function serialize(world: World, meta: { name: string; author: string }): Level;

export function validate(level: Level): { ok: true } | { ok: false; errors: string[] };

export function levelId(index: number): string;   // stable id for scores/URLs

/**
 * Stable id for a CUSTOM level. `Level` has no `id` field and Godot's
 * custom_levels.json is a bare array, so the id must be derived from content.
 * See "Custom level ids" below — T-03 owns the canonical implementation.
 */
export function customLevelId(level: Level): string;
```

### Custom level ids — a gap in the frozen types, resolved here

`Level` deliberately mirrors the persisted Godot JSON, which carries **no id**. But
`deleteCustomLevel(id)` (T-10), share links (T-13), and the editor's save flow (T-11) all need a
stable handle for a custom level. Three tasks would otherwise each invent their own.

**Canonical rule:** derive it deterministically from content —
`slug(name) + "-" + djb2(JSON.stringify(level))`. T-03 ATLAS owns `customLevelId()` and exports it;
everyone else imports it rather than reimplementing. T-10 VAULT shipped this shape first, under the
same name, so adopting it costs nothing.

Note the consequence: **renaming or editing a custom level changes its id.** That is acceptable for
local storage and unlisted share links (a new version is a new link), but it means ids are not
durable identity — do not use one as a database primary key that must survive an edit. T-12 LEDGER
mints its own independent slug for shared levels precisely for this reason.

Validation rules: exactly one player object; `goal.index` in range and not the player;
`goal.range > 0`; every object has finite coordinates; at least one body with `gravity > 0`.

---

## `web/render/index.ts` — T-04 AURORA

```ts
import type { World, Vec2, Prediction } from "@swingby/core/types";

export interface Camera { x: number; y: number; zoom: number; }

export interface RenderFrame {
  world: World;
  camera: Camera;
  trail: readonly Vec2[];
  prediction: Prediction | null;
  forceVector: Vec2 | null;
  boundsWarning: number;     // 0-1, drives the edge glow
  flash: number;             // 0-1, reset flash
  showTrail: boolean;
  editorOverlay?: unknown;   // opaque to the renderer; T-11 DRAFT defines it
}

export interface Renderer {
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  draw(frame: RenderFrame): void;
  /** World↔screen for hit-testing. Used by T-11 DRAFT. */
  worldToScreen(p: Vec2, camera: Camera): Vec2;
  screenToWorld(p: Vec2, camera: Camera): Vec2;
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer;
```

The renderer is **stateless with respect to gameplay** — it draws exactly what the frame says and
owns no simulation state. It must tolerate `world` mutating between frames.

---

## `web/game/loop.ts` — T-05 FLYWHEEL

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
  onComplete(cb: (r: { timeMs: number; boostMs: number; tape: ReplayTape }) => void): void;
  subscribe(cb: (s: GameSnapshot) => void): () => void;
}

export function createSession(opts: {
  level: Level;
  canvas: HTMLCanvasElement;
  input: InputSource;      // T-06
  audio: AudioSink;        // T-07
  settings: Settings;      // T-10
}): GameSession;
```

Fixed-timestep accumulator at `TICK_INTERVAL`, capped at 8 ticks per frame to avoid spiral-of-death
after a tab is backgrounded. Rendering is decoupled and runs once per rAF.

---

## `web/game/input.ts` — T-06 HELM

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

## `web/game/audio.ts` — T-07 CHORUS

```ts
export interface AudioSink {
  setBoost(active: boolean): void;
  setBrake(active: boolean): void;
  setAlarm(intensity: number): void;   // 0-1, bounds proximity
  chime(kind: "levelStart" | "goal" | "reset" | "click"): void;
  setMuted(muted: boolean): void;
  destroy(): void;
}

export function createAudio(): AudioSink;
```

All sound synthesized at runtime — **no audio files ship**. `createAudio()` must not construct an
`AudioContext` until the first user gesture, or autoplay policy will block it.

---

## `web/storage/index.ts` — T-10 VAULT

```ts
import type { Level, Settings } from "@swingby/core";

export interface PersonalBest { timeMs: number; boostMs: number; }

export interface Storage {
  getSettings(): Settings;
  setSettings(patch: Partial<Settings>): void;
  getBest(levelId: string): PersonalBest | null;
  recordBest(levelId: string, r: PersonalBest): { timeIsNew: boolean; boostIsNew: boolean };
  listCustomLevels(): Level[];
  saveCustomLevel(level: Level): void;
  deleteCustomLevel(id: string): void;
  export(): string;          // full JSON backup
  import(json: string): void;
}

export function createStorage(): Storage;
```

Must migrate cleanly from an empty store, and must never throw on corrupt data — reset to defaults
and keep going.

### Settings keys that live outside the frozen `Settings` type

| Key | Type | Owner | Accessors |
|---|---|---|---|
| `editLevelHotkey` | `string` | `web/ui/**` | `readEditLevelHotkey` / `editLevelHotkeyPatch` in `ui/view-models.ts` |

`Settings` is derived from `DEFAULT_SETTINGS` in `packages/core/src/constants.ts`, which is
**frozen** — that, and nothing else, is why this key is not declared there. It is a real, persisted
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

| Key | Owner | Written by |
|---|---|---|
| `swingby:settings` | T-10 VAULT | `web/storage/index.ts` |
| `swingby:bests` | T-10 VAULT | `web/storage/index.ts` |
| `swingby:custom_levels` | T-10 VAULT | `web/storage/index.ts` |
| `swingby:score_queue` | T-13 PODIUM | `web/net/queue.ts` (`QUEUE_STORAGE_KEY`) |

The convention is load-bearing, not cosmetic. Settings' "Delete all local data"
(`web/ui/localData.ts`) wipes by **prefix sweep**, not by a hard-coded list, so it keeps working when
a task adds a key without knowing about that button; and the same sweep is what lets it leave keys
belonging to other apps on the origin alone. A new key outside the namespace would silently survive
a wipe that promises the user everything is gone.

There are no cookies, no IndexedDB and no service worker in this app, deliberately. If you introduce
one, say so in your PR: those substrates are outside the sweep and the button's promise would need
widening. `packages/web/test/delete-local-data.test.ts` asserts the convention against the source of
both persisting modules.

---

## `api` — T-12 LEDGER

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

## `web/net/index.ts` — T-13 PODIUM

```ts
export interface LeaderboardEntry {
  rank: number; name: string; timeMs: number; boostMs: number; verified: boolean;
}

export interface Api {
  leaderboard(levelId: string, metric: "fastest" | "efficient"): Promise<LeaderboardEntry[]>;
  submitScore(s: { levelId: string; metric: string; timeMs: number; boostMs: number; name: string; tape: ReplayTape }): Promise<{ accepted: boolean; rank?: number }>;
  shareLevel(level: Level): Promise<{ id: string; url: string }>;
  fetchLevel(id: string): Promise<Level>;
}

export function createApi(baseUrl: string): Api;
```

Every method must degrade gracefully: the game stays fully playable with the API unreachable. Never
block a level start or completion on a network call.
