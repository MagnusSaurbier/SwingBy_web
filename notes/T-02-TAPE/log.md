# T-02 TAPE — working log

## 2026-08-13T00:00Z — Restart after usage-limit kill; plan before implementing

Killed almost immediately after launch on a prior attempt, before writing anything. Session
resumed, capacity restored. Re-read README.md, PROJECT.md, INTERFACES.md, tasks/T-02-TAPE.md,
types.ts, constants.ts, src/physics.ts (T-01, landed), src/level.ts (T-03, landed), and the
solvability harness (`test/level/solvability/{physics-adapter.ts,run.test.ts,tapes/*.json}`).
Nothing written to disk yet from the killed attempt — starting clean.

**Key finding — the 33 solvability tapes are ALREADY `ReplayTape`-shaped.** Read every one with a
one-liner (`node -e`): each file is exactly `{ ticks, boost: number[], brake: number[] }`, matching
`types.ts`'s `ReplayTape` byte-for-byte. No conversion needed beyond `JSON.parse` + a cast — the
task doc's caution ("their format may differ from yours") doesn't apply in practice here, which
simplifies the corpus test a lot. `ticks` is deliberately tight per T-03's log
(`notes/T-03-ATLAS/log.md:187`): `ticks = reachedTick + 1`, the minimum horizon that still reaches
goal. Several tapes have odd-length boost/brake arrays (e.g. builtin-03: boostLen=1) — control still
held at the tape's last tick, matches the documented odd-length semantics in types.ts:143-145.

**Design decisions before writing code:**

1. **`verifyReplay` tick/time semantics.** `TickResult` has no elapsed-time field, only booleans.
   Plan: simulate tick-by-tick from 0 up to `tape.ticks-1` using `inputAtTick` for each tick's input
   (not the recorder — the recorder is for producing tapes, not consuming them), `allowInput: true`
   throughout (matches T-03's solvability runner, `run.test.ts:111`), tracking `firstBoostFired`
   exactly like that runner does. Track the *first* tick at which `reachedGoal` is true — that's
   `elapsedTicks = firstReachedTick + 1`. If `outOfBounds` becomes true on a tick strictly before
   goal is ever reached, fail immediately with `reason: "out-of-bounds"` (task doc: "never left
   MAX_WORLD_BOUNDS **before that**" — i.e. only matters prior to capture). If goal is never reached
   within the tape's own `ticks`, fail `"no-goal"`. This treats `tape.ticks` as an upper bound the
   client claims to have recorded up to, not as ground truth for the score — the score's real
   `elapsedTicks` is whatever tick the simulation actually captures on, which is what gets compared
   to `claim.timeMs`. Rationale: this closes a forgery path where a client pads `tape.ticks` far
   beyond the real capture tick with idle input, hoping the extra ticks are believed as part of the
   time — they aren't; only the *first* capture matters.
   - `boostMs`: count ticks with `boost === true` from tick 0 through the capture tick inclusive,
     converted to ms. Ticks after capture are irrelevant (game session ends at capture) and are
     never simulated past that point in the first place, since the loop breaks the moment
     `reachedGoal` is true.

2. **ms conversion.** Ticks are the durable integer; `constants.ts` has `TPS = 144`, so
   `msPerTick = 1000/144 = 6.9999...`. `elapsedTicks * msPerTick` is not generally an integer.
   PROJECT.md §4: "convert to ms only at display and API boundaries" — `VerifyResult.timeMs` IS that
   boundary. Decision: round to the nearest integer ms (`Math.round`) when producing
   `VerifyResult.timeMs`/`boostMs`. Flagging as an ASSUMPTION: no other landed task defines the
   canonical tick→ms rounding rule, so if T-05 FLYWHEEL's `GameSnapshot`/`onComplete` path computes
   `timeMs` differently (floor vs round, or accumulates rAF wall time instead of ticks — the latter
   would itself be a PROJECT.md §4 violation: "Never accumulate wall-clock time into the sim"), the
   default zero-tolerance comparison could reject genuine runs. Tolerance is a parameter for exactly
   this reason (task doc says so explicitly) — shipping at 0 per spec, documenting the risk here.

3. **Malformed-claim hardening.** `claim: {timeMs, boostMs}` is attacker-controlled too (it rides
   along in the same POST body per INTERFACES.md's `/api/score`). Two traps to avoid:
   - `NaN` claim values: `Math.abs(sim - NaN) > tol` is `false` in JS (NaN comparisons are always
     false), which would make a bad comparison silently PASS. Must explicitly
     `Number.isFinite(claim.timeMs)` before comparing, else treat as mismatch.
   - `claim` itself could be `null`/missing fields if a caller bypasses the type system with parsed
     JSON — use `claim?.timeMs` (optional chaining) rather than direct property access, so a
     malformed claim object degrades to "mismatch" instead of throwing.

4. **Encoding.** `encodeTape`/`decodeTape` must run identically in node and browser with zero deps —
   no `Buffer`, no `btoa`/`atob` (not a universal language builtin; Node only shims them as of newer
   versions and it's a Web API, not ECMAScript). Plan: hand-rolled unsigned LEB128 varints
   (delta-encoded within each strictly-increasing transition array, since delta ≥ 0 always, ≥1 after
   the first entry) packed into a `Uint8Array`, then a hand-rolled base64url encode/decode (own
   alphabet table, bit math only — `Uint8Array`/string/`Math` are true ECMAScript builtins available
   identically in both environments). No padding characters (URL-safe, shorter). Decode must guard
   against an unterminated varint (continuation bit always set) hanging forever — cap at 10
   continuation bytes, matches enough headroom for values far beyond any real tick count.

5. **Test location override.** Task doc (tasks/T-02-TAPE.md:15) says
   `packages/core/test/replay.test.ts`, singular file. Orchestrator's instructions for this run
   explicitly override that: tests go under `packages/core/test/replay/**`, and I must not touch
   `test/parity/**` (T-01) or `test/level/**` (T-03). Following the orchestrator instruction as the
   more specific/current directive. Noting the discrepancy here in case a reviewer diffs against the
   task doc literally.

6. **`index.ts` — not touched.** `packages/core/src/index.ts` is explicitly off-limits (orchestrator
   rule, not in the file-ownership table's exclusions but stated directly for this task). It currently
   exports `./types.js`, `./constants.js`, `./physics.js`, `./level.js` but not `./replay.js` — will
   flag in results/T-02-TAPE.md that the orchestrator needs to add
   `export * from "./replay.js";` there.

**Next step:** write `packages/core/src/replay.ts` implementing `TapeRecorder`, `inputAtTick`
(binary search — count of transitions ≤ tick, odd ⇒ held, matches the reference `stateAtTick` helper
duplicated in `test/level/solvability/run.test.ts:34-41`), `verifyReplay`, `encodeTape`,
`decodeTape`. Then tests under `packages/core/test/replay/`, including the 33-tape corpus, hostile
inputs, round-trip, O(log n) timing, and the fail-proof demonstration (temporarily break
`verifyReplay`, show red, revert, record output). Then `results/T-02-TAPE.md`.
