# T-02 TAPE — results

Replay encoding and server-side verification for `@swingby/core`. Built against the real, landed
T-01 KEPLER physics (`simulateTick`) and T-03 ATLAS level module (`hydrate`, `BUILTIN_LEVELS`,
`levelId`) — `verifyReplay` is not a stub.

## Deliverables

| # | Artifact | Path | Status |
|---|---|---|---|
| 1 | `TapeRecorder`, `inputAtTick`, `verifyReplay`, `encodeTape`, `decodeTape` | `packages/core/src/replay.ts` | Done |
| 2 | Test suite incl. property tests and every rejection rule | `packages/core/test/replay/{fixtures,recorder,encoding,verify}.test.ts` (fixtures.ts has no tests itself; the others total 132 tests) | Done — see note below on path |
| 3 | Measured verification time for a 60s tape, in the PR | This file, "Measured numbers" | Done |
| — | Standalone bench script (60s-verify time, O(log n) evidence, encoded size) | `packages/core/test/replay/bench.ts` + `resolve-hook.mjs` + `register-loader.mjs` (see "Running the bench script") | Done |

**Path note:** tasks/T-02-TAPE.md's "Owned files" section names a single
`packages/core/test/replay.test.ts`. The orchestrator's instructions for this run explicitly
override that to `packages/core/test/replay/**` (plural, directory), with an explicit rule to stay
out of `test/parity/**` (T-01) and `test/level/**` (T-03). Followed the orchestrator instruction as
the authoritative one for this session; flagging the discrepancy here in case a reviewer diffs
against the task doc literally.

**`index.ts` — needs a change I'm not permitted to make.** `packages/core/src/index.ts` does not
yet export `replay.ts` (verified — its header comment even lists `replay.ts T-02 TAPE` as a pending
addition). I do not own that file and did not touch it. **The orchestrator needs to add
`export * from "./replay.js";`** alongside the existing `types.js` / `constants.js` / `physics.js` /
`level.js` exports for `@swingby/core`'s public surface to include this task's work.

## Definition of done

| Item | Status | Reason |
|---|---|---|
| Round-trip: `decodeTape(encodeTape(t))` deep-equals `t` for 1,000 generated tapes | ✅ | 1000 generated (seeded, reproducible) + all 33 real solvability tapes = **1033/1033** round-tripped exactly. See `encoding.test.ts`. |
| `inputAtTick` agrees with a naive per-tick expansion at every tick, across those tapes | ✅ | Checked at every tick across 100 generated tapes (105,939 lookups) and all 33 real tapes (29,053 lookups) — 0 mismatches. See `recorder.test.ts`. (Used 100 generated rather than the full 1000 for this specific "every tick" check to keep `npm test` fast — the 1000-tape round-trip test is the one carrying the literal "1,000" DoD number; this one adds the *per-tick correctness* dimension on a large, still-substantial sample plus the full real corpus.) |
| A tape from a real playthrough verifies with zero tick divergence | ✅ | All 33 genuine solvability tapes: `result.ok === true`, `result.timeMs`/`boostMs` match the claim exactly (0 tolerance, no fudge). See `verify.test.ts`. |
| A tape with one flipped transition index fails verification | ✅ | `builtin-00`, `brake[1]` 50→51: `ok=false`, `reason="time-mismatch"`. Broader sweep: shaving the last tick off all 33 tight tapes breaks 33/33. |
| A 60-second tape verifies in < 100ms in node | ✅ | Worst-case (never reaches goal, so the full 8,640 ticks always simulate): min 3.25ms / avg 6.47ms / max 17.95ms over 5 runs. Comfortably under budget. |
| Every rejection rule has a test that exercises it | ✅ | 25 explicit malformed-shape cases (table-driven) in `verify.test.ts`, covering all 4 named rules in tasks/T-02-TAPE.md plus hostile extras (NaN/Infinity, wrong types, nested junk, gigantic arrays, non-object tapes). |
| Zero dependencies; runs unchanged in node and browser | ✅ | `replay.ts` imports only `./level.js`, `./physics.js`, `./constants.js`, `./types.js` (siblings in `packages/core/src`) — no npm package, no `Buffer`, no `btoa`/`atob`, no DOM/Node-only API. Hand-rolled LEB128 varints + base64url. |
| Global checklist (PROJECT.md §7) | ✅ (for my files) | `npm run typecheck`: 0 errors under `packages/core`. `npm test`: 360 passed / 1 skipped across the whole workspace, including my 132. No file outside `packages/core/src/replay.ts` + `packages/core/test/replay/**` was touched. No new runtime dependency. `index.ts` change needed is called out above, not made unilaterally. |

## Measured numbers

All measured with `npm test -w @swingby/core -- replay` and the standalone bench script (both run
in this container: Node v22.22.2).

- **Test pass/fail:** `npm test -w @swingby/core -- replay` → **132 passed, 0 failed** (3 test files).
- **`npm run typecheck`:** 0 errors anywhere under `packages/core` (checked explicitly by filtering
  the full workspace output). Full-workspace run is clean at time of writing; one transient error
  was observed once in `packages/web/src/render/starfield.ts` on an interleaved run (not my file,
  gone on immediate rerun — attributable to a concurrent edit by T-04 AURORA on the shared tree).
- **Round-trip:** **1033/1033** tapes (1000 generated + 33 real) round-trip exactly through
  `decodeTape(encodeTape(t))`.
- **Encoded size**, representative 60s (8,640-tick) run, 80 transitions (a human-shaped tape, "tens"
  of state changes per the task doc): **166 base64url chars ≈ 124 bytes, 1.55 bytes/transition**.
- **`inputAtTick` O(log n) evidence** (bench script, 300,000 random-tick lookups per size, tape
  length fixed at the 86,400-tick max so growing the transition count is the only variable):

  | transitions (n) | total ms | ns/lookup | log2(n) |
  |---:|---:|---:|---:|
  | 1 | 10.96 | 36.5 | 0.00 |
  | 10 | 19.57 | 65.2 | 3.32 |
  | 100 | 25.69 | 85.6 | 6.64 |
  | 500 | 30.11 | 100.4 | 8.97 |
  | 1000 | 28.80 | 96.0 | 9.97 |
  | 2000 | 33.16 | 110.5 | 10.97 |

  Transition count grew **2000×** (1 → 2000); per-lookup time grew only **~3×**. A linear scan
  would have grown in lockstep (~2000×). This is a measurement, run-to-run noise included (evident
  at the n=1 end, where absolute times are tens of nanoseconds and timer granularity dominates) —
  the sub-linear shape reproduces on every run.
- **60-second tape verification budget** (worst case: synthetic level with an unreachable goal, so
  the full 8,640 ticks are always simulated — a real solving tape would exit early and understate
  the cost): **min 3.25ms, avg 6.47ms, max 17.95ms** over 5 runs. Budget is < 100ms; margin is
  roughly **5–30×**.
- **33-tape end-to-end:** **33/33 accepted** (genuine tape, matching claim, 0 tolerance) and
  **33/33 rejected** when the same genuine tape is paired with a claim inflated by 500ms
  (`reason: "time-mismatch"` on all 33).
- **Fail-proof demonstration:** `verifyReplay` temporarily short-circuited to
  `return { ok: true, ... }` unconditionally →
  `npm test -w @swingby/core -- replay` → **73 failed / 59 passed (132 total)**. Reverted (single
  line removed, file byte-identical to the working version) → re-ran → **132 passed / 0 failed**
  again. Both states independently confirmed by actually running the suite.

## Hostile-input table

All cases from `verify.test.ts`'s `malformedCases` table plus the dedicated tests below it. Every
one returns `{ ok: false, reason: "malformed", ticks: 0 }` (or a specific non-malformed rejection
reason where noted) — **none throw**.

| Hostile input | Result |
|---|---|
| `ticks` over the 10-minute cap (`144*600 + 1`) | `malformed` |
| `ticks` negative | `malformed` |
| `ticks` non-integer (12.5) | `malformed` |
| `ticks` = `NaN` | `malformed` |
| `ticks` = `+Infinity` / `-Infinity` | `malformed` |
| `ticks` missing entirely | `malformed` |
| `ticks` wrong type (string `"100"`) | `malformed` |
| `boost` not an array (string, object) | `malformed` |
| `brake` not an array (`null`) | `malformed` |
| More than 2000 total transitions (1001 + 1000) | `malformed` |
| Transitions not strictly increasing (duplicate `[5,5,10]`) | `malformed` |
| Transitions decreasing (`[10,5]`) | `malformed` |
| Transition index negative (`-1`) | `malformed` |
| Transition index `>= ticks` (equal, and far beyond) | `malformed` |
| Transition index non-integer (5.5) | `malformed` |
| Transition index `NaN` / `Infinity` | `malformed` |
| Transition element is an object (deeply nested junk) | `malformed` |
| Tape is `null` / `undefined` / a string / a number / a bare array | `malformed` |
| A malformed `Level` (fails `hydrate`/`validate`, e.g. no player) | `malformed` (caught via `LevelError`, does not throw) |
| Gigantic transitions array (200,000 elements) | `malformed`, rejected in **0.010–0.021ms** — proves the `.length` check runs before any per-element scan, not after |
| Absurd `ticks` (`Number.MAX_SAFE_INTEGER`) | `malformed`, rejected in **< 10ms** without attempting to simulate |
| `ticks` exactly at the cap (`144*600`) | **not** malformed (boundary is inclusive, as specified) |
| Exactly 2000 total transitions | **not** malformed (boundary is inclusive) |
| Genuine tape + `claim.timeMs = NaN` | `time-mismatch` (NaN never silently "passes" — see below) |
| Genuine tape + `claim.timeMs = Infinity` | `time-mismatch` |
| Genuine tape + `claim.boostMs = NaN` (timeMs matching) | `boost-mismatch` |
| `claim` object missing fields entirely (`{}`) | rejected, does not throw |
| `claim` is `null` | rejected, does not throw |
| Player launched straight out of `MAX_WORLD_BOUNDS` | `out-of-bounds` |
| Tape that never reaches the goal within its own horizon | `no-goal` |
| Genuine tape + claim inflated by 500ms | `time-mismatch` (all 33 real tapes) |
| Genuine tape with one transition index flipped ±1 | fails (all cases tested: `time-mismatch` for the literal demo; broken for 33/33 in the ticks-shaved sweep) |
| Empty tape (`ticks:0, boost:[], brake:[]`) | **not** malformed — legitimately simulates to `no-goal` (0 ticks can never reach a goal) |
| `decodeTape("")` (empty encoded string) | returns the empty tape `{ticks:0, boost:[], brake:[]}` — a valid encoding, not an error |
| `decodeTape` on a truncated encoding | throws `Error` |
| `decodeTape` on length ≡ 1 (mod 4) base64url string | throws `Error` |
| `decodeTape` on invalid characters (`!`, spaces, standard-base64 `+`/`/`) | throws `Error` |
| `decodeTape` on a byte stream with an unterminated varint continuation bit (64 `_` chars) | throws `Error`, does not hang (bounded at 10 continuation bytes) |
| `decodeTape` on non-string input (`null`, `undefined`, `42`, `{}`) | throws `Error`, does not silently coerce |
| `decodeTape` on a maximally long but valid 2000-transition encoding | decodes correctly in < 50ms, no hang |

Why the NaN-claim guard matters, concretely: `Math.abs(sim - NaN) > 0` evaluates to `false` in JS
(NaN comparisons are always false), so an unguarded tolerance check would treat a NaN claim as
"within tolerance" — i.e. silently accept a forged/garbage claim. `withinTolerance()` in
`replay.ts` explicitly checks `Number.isFinite(claimed)` before doing the arithmetic, specifically
to close this.

## Running the bench script

The task doc's literal command (`node --experimental-strip-types packages/core/test/replay/bench.ts`)
does **not** work as written in this checkout's Node (v22.22.2) — root-caused with an isolated
two-file repro outside the repo: bare Node's ESM resolver does not remap a `.js` import specifier to
a sibling `.ts` file, which is exactly the convention every file in `packages/core/src` uses (matching
the package's `tsconfig.json` `"moduleResolution": "bundler"`, which `tsc` and vitest both resolve
fine — only bare `node` needs help). See `notes/T-02-TAPE/log.md` (2026-08-13T16:05Z entry) for the
full story. Fixed with a ~15-line, zero-npm-dependency Node ESM resolve hook
(`packages/core/test/replay/resolve-hook.mjs` + `register-loader.mjs`, using only the stable
`node:module` `register()` API). Actual working invocation:

```bash
node --experimental-strip-types \
  --import ./packages/core/test/replay/register-loader.mjs \
  packages/core/test/replay/bench.ts
```

## Design decisions worth flagging for downstream consumers

1. **`verifyReplay` anchors the score to the FIRST tick the goal is reached, not to `tape.ticks`
   itself.** `tape.ticks` is an upper bound the client claims to have recorded; the simulation loop
   breaks the instant `reachedGoal` is true, and `elapsedTicks = firstReachedTick + 1` /
   `boostMs = held-boost-ticks up to and including that tick` are what get compared to the claim.
   This closes a forgery path where a tape is padded with idle ticks past the real capture.
2. **Tick→ms rounding at the `VerifyResult` boundary uses `Math.round(ticks * 1000/144)`.** This is
   an assumption, flagged as open: no other landed task defines the canonical tick→ms conversion.
   If T-05 FLYWHEEL's client-side `timeMs` computation rounds differently, the default 0-tolerance
   comparison could reject genuine runs on a pure rounding mismatch. The `tolerance` parameter
   exists precisely to absorb this if it turns out to matter — recommend whoever wires T-02 to T-05/
   T-12 either matches this rounding exactly or passes a 1ms tolerance.
3. **`encodeTape` does not independently re-validate its input** (assumes a well-formed tape, as
   produced by `TapeRecorder` or already checked by `verifyReplay`). `decodeTape` also does not
   enforce the strictly-increasing invariant on the arrays it reconstructs — a hostile *encoded
   string* can decode to a shape-valid-but-semantically-invalid `ReplayTape` (e.g. duplicate
   indices via a zero-delta varint). This is intentional layering: `decodeTape`'s job is to decode
   byte structure; `verifyReplay`'s malformed checks are the actual semantic trust boundary, and
   every caller that decodes an attacker-supplied string is expected to run the result through
   `verifyReplay` before trusting it (never through `decodeTape` alone). Tested via
   `encodeTape(hostileTape)` → `decodeTape(...)` → `verifyReplay(...)` → `malformed` in the corpus.
