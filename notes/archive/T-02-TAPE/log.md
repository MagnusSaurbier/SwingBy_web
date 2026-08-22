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

## 2026-08-13T16:05Z — Implementation complete, all measurements taken

**`verifyReplay` semantics — the load-bearing decision, stated precisely.** `tape.ticks` is treated
as an upper bound the client claims to have recorded, NOT ground truth for the score. The simulation
runs tick-by-tick from 0; the score is anchored to the FIRST tick `reachedGoal` becomes true
(`elapsedTicks = firstReachedTick + 1`), and `boostMs` counts held-boost ticks from 0 through that
tick inclusive. This closes a forgery path: padding `tape.ticks` with idle ticks past the real
capture can't manufacture a slower/different advertised time, because the loop simply breaks at
first capture and never looks past it. Confirmed empirically against all 33 real tapes (which are
tight, `ticks = reachedTick + 1` per T-03's log) — every one accepts with `result.ticks === tape.ticks`
exactly, so this semantics is consistent with genuine tight tapes, not just a theoretical guard.

**Dead end ruled out: raw `node --experimental-strip-types <file>.ts` does not work for this
package, at all, full stop — not a config issue.** Tried to run `bench.ts` per the task doc's literal
"How to verify" command. Failed with `ERR_MODULE_NOT_FOUND` on `../../src/replay.js`. Root-caused
with a two-file isolated repro OUTSIDE the repo (`/tmp/.../ts-resolve-test/{a,b}.ts`, `a.ts` importing
`./b.js` where only `b.ts` exists): fails identically on bare Node v22.22.2, with or without
`--experimental-strip-types` (it's on by default in this Node; the flag is actually
`--no-experimental-strip-types` to turn it OFF). Node's type-stripping does not remap a `.js`
specifier to a sibling `.ts` file — that's purely a `tsc`/bundler/vitest (esbuild) resolution
convenience, not something Node's runtime ESM loader does. This affects EVERY file in
`packages/core/src` equally (they all import each other via `"./x.js"` pointing at `x.ts`, matching
the package's `tsconfig.json` `"moduleResolution": "bundler"`), so it's not specific to `replay.ts`.
Neither T-01 nor T-03 hit this because neither shipped a standalone-node-executed script — their
only entry points are vitest test files, and vitest's resolver handles the remap transparently.
PROJECT.md:166 ("Until T-14 lands, run files directly...") is stale advice from before this was
discovered; T-14 has since landed the real `npm test`/`npm run typecheck` scripts anyway.

**Fix (not a workaround — zero new npm dependencies):** wrote a ~15-line Node ESM "resolve" hook
(`packages/core/test/replay/resolve-hook.mjs` + `register-loader.mjs`, using only the stable
`node:module` `register()` API) that retries a failed `.js` specifier as `.ts` once. Verified against
the same isolated repro first, then against the real `bench.ts` — works. Documented the exact
invocation in `bench.ts`'s header comment and in `results/T-02-TAPE.md`. This is genuinely
test-only tooling under my own `test/replay/**`, doesn't touch `packages/core/src`'s zero-dependency
contract (no npm package, no `src/` change), and is the only way the literal "How to verify" command
in tasks/T-02-TAPE.md can work in this checkout.

**Measurements (see `results/T-02-TAPE.md` for the full table):**
- `npm test -w @swingby/core -- replay`: **132/132 passed**, 0 failed.
- Round-trip corpus: **1033/1033** (1000 generated + all 33 real tapes) decode-exactly-equals-encode.
- Encoded size, representative 60s/8640-tick tape (80 transitions): **166 chars / ~124 bytes, 1.55
  bytes/transition**.
- `inputAtTick` O(log n) evidence: transition count grew **2000×** (1→2000), per-lookup time grew
  only **~3×** (measured via `bench.ts`, 300k lookups per size, ticks fixed at the 86400 max so the
  comparison isn't confounded by tape length changing too) — a linear scan would have grown ~2000×
  in lockstep. Numbers vary run-to-run (timer noise dominates at n=1's ~36ns/lookup), but the
  sub-linear shape reproduces every run.
- 60s-tape `verifyReplay` (worst case — synthetic `BENCH_LEVEL`, an unreachable goal so the FULL
  8640 ticks always simulate, never an early exit): **min 3.25ms / avg 6.47ms / max 17.95ms** over 5
  runs. Budget is <100ms — comfortable margin (~5-30×).
- 33-tape end-to-end: **33/33 genuine tapes accepted** with zero tick divergence, **33/33 rejected**
  when the claim is inflated by 500ms. Separately, tamper-testing by shaving the last tick off each
  of the 33 (tight-by-construction) tapes: **33/33 broken**.
- Fail-proof demonstration: short-circuited `verifyReplay` to `return {ok:true, ...}` unconditionally
  (one line, right after the signature) → `npm test -w @swingby/core -- replay` went to **73
  failed / 59 passed (132 total)**. Reverted (single-line removal, file matches original) →
  back to **132/132 passed**. Both confirmed by rerunning the suite, not just eyeballing the diff.

**Open question / assumption still flagged (see entry 2 above, point 2):** ms rounding
(`Math.round(ticks * 1000/144)`) at the `VerifyResult` boundary is MY choice, made in the absence of
a landed T-05 FLYWHEEL to cross-check against. If T-05's `onComplete` callback computes `timeMs`
differently (e.g. floors instead of rounds, or derives it some other way), the default zero-tolerance
comparison could reject genuine client-submitted scores purely on a rounding mismatch — not a replay
bug, a units-boundary mismatch. Flagging for whoever wires T-02 up to T-05/T-12: either match this
rounding exactly, or pass a 1ms `tolerance` to absorb it (the parameter exists precisely for this).

**State at end of session:** implementation complete, all deliverables written, all DoD items
verified with numbers (see results/T-02-TAPE.md), `npm run typecheck` clean for `packages/core`
(saw one transient error in `packages/web/src/render/starfield.ts` on one run, gone on immediate
rerun — almost certainly T-04 AURORA mid-save on the shared tree, not anything of mine; confirmed
zero errors under `packages/core` on every run). Nothing left to do on this task besides the
orchestrator wiring `export * from "./replay.js";` into `index.ts` (I do not own that file).
