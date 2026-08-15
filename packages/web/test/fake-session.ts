/**
 * T-09 GAUGE — deliverable 5: a fake `GameSession` (the frozen T-05 FLYWHEEL interface, imported
 * read-only from `../src/game/loop.js` — not edited, not duplicated) that emits SCRIPTED snapshots
 * on demand instead of running a real simulation. This is what makes every other HUD module testable
 * without a browser, a canvas, or the real physics/renderer stack — see notes/T-09-GAUGE/log.md's
 * plan entry, finding "Build it first."
 *
 * Design: `push`/`patch` give a test full manual control over exactly what `subscribe` callbacks
 * see and when (bounds warning ramping 0->1 one step at a time, a paused snapshot, a resetting
 * snapshot, an out-of-order/duplicate snapshot to prove diff-on-write, etc.) — deliberately NOT a
 * fixed "scenario script that plays itself on a timer", because every consumer (hud.ts, pause.ts,
 * complete.ts) needs a *different* sequence and forcing them through one rigid script would just
 * mean unwinding it again in each test. `start`/`pause`/`resume`/`restart`/`destroy` still behave
 * plausibly (they update `status` and notify subscribers, not just increment a counter) so a test
 * can drive pause.ts's "Resume" button and assert BOTH that `session.resume()` was called AND that
 * the resulting snapshot looks like a real one would.
 */

import type {
  CompletionPayload,
  GameSession,
  GameSnapshot,
  GameStatus,
} from "../src/game/loop.js";

export type CallCounts = Record<
  "start" | "pause" | "resume" | "restart" | "destroy",
  number
>;

export interface FakeSession extends GameSession {
  /** Replaces the current snapshot wholesale and notifies every subscriber. Full manual control —
   *  does NOT go through start/pause/resume/restart's own (more realistic) status transitions. */
  push(snapshot: GameSnapshot): void;
  /** Merges `partial` over the last-pushed snapshot and pushes the result. The common case: most
   *  tests only want to change one or two fields per step. */
  patch(partial: Partial<GameSnapshot>): void;
  /** Invokes every registered onComplete callback with `payload`, exactly once, synchronously. */
  fireComplete(payload: CompletionPayload): void;
  /** How many times each GameSession method was called — lets a test assert e.g. that clicking
   *  "Resume" in the pause panel actually called `session.resume()`. */
  readonly calls: CallCounts;
  /** Number of currently-registered subscribers — used to prove destroy()/unsubscribe don't leak. */
  subscriberCount(): number;
}

const DEFAULT_SNAPSHOT: GameSnapshot = Object.freeze({
  status: "paused",
  elapsedTicks: 0,
  boostTicks: 0,
  fps: 0,
  boundsWarning: 0,
  reachedGoal: false,
});

export function createFakeSession(initial?: Partial<GameSnapshot>): FakeSession {
  let snapshot: GameSnapshot = { ...DEFAULT_SNAPSHOT, ...initial };
  const subscribers: Array<(s: GameSnapshot) => void> = [];
  const completeCallbacks: Array<(r: CompletionPayload) => void> = [];
  const calls: CallCounts = {
    start: 0,
    pause: 0,
    resume: 0,
    restart: 0,
    destroy: 0,
  };

  function notify(): void {
    // Snapshot the subscriber list before iterating, matching the real loop.ts's own dispatch
    // discipline (a callback that subscribes/unsubscribes mid-dispatch must not affect this pass).
    for (const cb of subscribers.slice()) cb(snapshot);
  }

  function push(next: GameSnapshot): void {
    snapshot = next;
    notify();
  }

  function patch(partial: Partial<GameSnapshot>): void {
    push({ ...snapshot, ...partial });
  }

  return {
    push,
    patch,
    calls,

    fireComplete(payload: CompletionPayload): void {
      for (const cb of completeCallbacks.slice()) cb(payload);
    },

    subscriberCount(): number {
      return subscribers.length;
    },

    start(): void {
      calls.start++;
      patch({ status: "playing" satisfies GameStatus });
    },
    pause(): void {
      calls.pause++;
      if (snapshot.status === "playing") patch({ status: "paused" });
    },
    resume(): void {
      calls.resume++;
      if (snapshot.status === "paused") patch({ status: "playing" });
    },
    restart(): void {
      calls.restart++;
      patch({
        status: "resetting",
        elapsedTicks: 0,
        boostTicks: 0,
        reachedGoal: false,
      });
    },
    destroy(): void {
      calls.destroy++;
      subscribers.length = 0;
      completeCallbacks.length = 0;
    },
    snapshot(): GameSnapshot {
      return snapshot;
    },
    onComplete(cb: (r: CompletionPayload) => void): void {
      completeCallbacks.push(cb);
    },
    subscribe(cb: (s: GameSnapshot) => void): () => void {
      subscribers.push(cb);
      return () => {
        const idx = subscribers.indexOf(cb);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Pure snapshot builder — no session needed, useful for hints/format unit tests that only need a
// `GameSnapshot`-shaped value, not a live subscribe() feed.
// ---------------------------------------------------------------------------

export function makeSnapshot(overrides?: Partial<GameSnapshot>): GameSnapshot {
  return { ...DEFAULT_SNAPSHOT, ...overrides };
}

// ---------------------------------------------------------------------------
// Scripted drive helpers — named scenarios the brief calls out explicitly: "bounds warning ramping
// 0->1, the reset flash, a completion with and without a new personal best, paused and resetting
// states." Each just calls push/patch in a loop; kept as named functions purely so every consumer
// test reads the same recognizable scenario rather than re-deriving the numbers each time.
// ---------------------------------------------------------------------------

/** Pushes `steps` snapshots with `boundsWarning` ramping linearly from 0 to 1, status "playing",
 *  `elapsedTicks` advancing one tick per step. Returns the pushed snapshots in order. */
export function driveBoundsWarningRamp(
  session: FakeSession,
  steps = 10,
): GameSnapshot[] {
  const out: GameSnapshot[] = [];
  for (let i = 0; i <= steps; i++) {
    session.patch({
      status: "playing",
      boundsWarning: i / steps,
      elapsedTicks: session.snapshot().elapsedTicks + 1,
    });
    out.push(session.snapshot());
  }
  return out;
}

/** Pushes a "resetting" snapshot (boundsWarning already back at 0, ticks zeroed — matches the real
 *  loop.ts's resetAttempt(), which zeroes bookkeeping immediately, before the flash finishes), then
 *  a "playing" snapshot once the flash would have completed. */
export function driveResetFlash(session: FakeSession): GameSnapshot[] {
  session.patch({
    status: "resetting",
    elapsedTicks: 0,
    boostTicks: 0,
    boundsWarning: 0,
    reachedGoal: false,
  });
  const resetting = session.snapshot();
  session.patch({ status: "playing" });
  const playing = session.snapshot();
  return [resetting, playing];
}

export function drivePaused(
  session: FakeSession,
  overrides?: Partial<GameSnapshot>,
): GameSnapshot {
  session.patch({ status: "paused", ...overrides });
  return session.snapshot();
}

/** Drives to a completion: sets reachedGoal/status, then fires onComplete with `payload`. Returns
 *  the payload for convenience so a test can assert against it without re-threading it. */
export function driveCompletion(
  session: FakeSession,
  payload: CompletionPayload,
): CompletionPayload {
  session.patch({
    status: "complete",
    reachedGoal: true,
    elapsedTicks: msToTicksForTest(payload.timeMs),
    boostTicks: msToTicksForTest(payload.boostMs),
  });
  session.fireComplete(payload);
  return payload;
}

/** Test-only inverse of the real ticksToMs (`Math.round(ticks * 1000/TPS)`) — approximate on
 *  purpose, only used to keep `driveCompletion`'s snapshot bookkeeping in the same ballpark as its
 *  payload; the payload itself (not this) is what any assertion about exact ms values must use. */
function msToTicksForTest(ms: number): number {
  return Math.round((ms * 144) / 1000);
}
