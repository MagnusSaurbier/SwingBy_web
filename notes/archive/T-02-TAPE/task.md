# T-02 · TAPE — Replay encoding and verification

**Area:** `packages/core` · **Depends on:** T-01 KEPLER *(interface only — do not wait for it)*
**Blocks:** T-12 LEDGER

## Goal

Make a completed run reproducible from a few hundred bytes, so the server can replay it and confirm
the score is real. This is what makes the leaderboard trustworthy without accounts or obfuscation.

## Owned files

```
packages/core/src/replay.ts
packages/core/test/replay.test.ts
```

## Interface

Exactly as in [INTERFACES.md](../INTERFACES.md#corereplayts--t-02-tape).

## Why this works

The simulation is deterministic: fixed 144 Hz tick rate, substep count derived only from body state,
no randomness anywhere in the physics path. Same level plus same per-tick input always produces the
same trajectory. So a score is fully described by its input tape.

## Encoding

Boost and brake are booleans sampled once per tick. A 60-second run is 8,640 ticks, but a human
generates on the order of tens of state changes. Store **transition tick indices**, starting from
released:

```json
{ "ticks": 8640, "boost": [412, 470, 1203, 1250], "brake": [3100, 3180] }
```

Boost is held on `[412, 470)` and `[1203, 1250)`. An odd-length array means the control was still
held at the final tick. Typical tape: a few hundred bytes.

`encodeTape` produces a URL-safe string compact enough for a share link — base64url over a
varint-delta encoding of the transition indices is plenty. Do not reach for a compression library;
the payload is already tiny and a dependency here would violate `core`'s zero-dependency rule.

## Verification

`verifyReplay` hydrates the level, replays the tape through `simulateTick`, and reports what actually
happened. It must:

- Confirm the player entered `goalRange` of the goal body.
- Confirm the player never left `MAX_WORLD_BOUNDS` before that.
- Compare simulated elapsed and boost ticks against the client's claim.
- Default tolerance: **0 ticks**. The simulation is deterministic; a mismatch is either a bug or a
  forgery, and silently accepting either is worse than rejecting. Make tolerance a parameter so it
  can be loosened if reality disagrees, but ship it at zero.

## Rejection rules

Treat as `malformed` without simulating — these are cheap guards against resource exhaustion, and
they run before any physics work:

- `ticks > 144 * 600` (ten minutes)
- more than 2,000 total transitions
- transition arrays not strictly increasing
- any index `< 0` or `>= ticks`

## Deliverables

| # | Artifact | Path |
|---|---|---|
| 1 | `TapeRecorder`, `inputAtTick`, `verifyReplay`, `encodeTape`, `decodeTape` | `packages/core/src/replay.ts` |
| 2 | Test suite incl. property tests and every rejection rule | `packages/core/test/replay.test.ts` |
| 3 | Measured verification time for a 60 s tape, in the PR | — |

## Definition of done

- [ ] Round-trip: `decodeTape(encodeTape(t))` deep-equals `t` for 1,000 generated tapes
- [ ] `inputAtTick` agrees with a naive per-tick expansion at every tick, across those tapes
- [ ] A tape from a real playthrough verifies with **zero** tick divergence
- [ ] A tape with one flipped transition index fails verification
- [ ] A 60-second tape verifies in **< 100 ms** in node — report the number
- [ ] Every rejection rule has a test that exercises it
- [ ] Zero dependencies; runs unchanged in node and browser
- [ ] Plus the global checklist in [PROJECT.md §7](../PROJECT.md#7-definition-of-done-globally)

## Note

`TapeRecorder` is fed by T-05 FLYWHEEL, which calls `record(tick, input)` once per simulated tick.
You own the recorder; FLYWHEEL owns the call site.

## How to verify

```bash
npm test -w @swingby/core -- replay
npm run typecheck
```

**Measure the verification budget** — this is a hard number T-12 depends on:

```bash
node --experimental-strip-types packages/core/test/replay-bench.ts
```

It must print the wall time for a 60-second tape. Under 100 ms passes; report the figure.

**Prove the tamper check works.** Take a passing tape, flip one transition index by ±1, re-run
`verifyReplay`, and confirm it fails. A verifier that never rejects is the failure mode here, and it
looks exactly like a verifier that works.

**Before T-05 exists**, generate tapes by scripting input directly through `simulateTick` rather than
waiting for a real playthrough. Once FLYWHEEL lands, re-run against a genuine recording — that is the
end-to-end check that matters.
