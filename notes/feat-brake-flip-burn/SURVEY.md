# Survey — `feat/brake-flip-burn` (raw findings, plan not yet written)

Request (verbatim from owner): *"braking should count towards the boost highscore same as boosting.
Additionally, while braking, the rocket shall flip and the flame shall be visible (pointing in the
direction of flight) ie. pressing the brake button performs an instant flip and burn maneuver. also
the sound shall be the same as boosting."*

Status: **surveying, interrupted before the plan was drafted.** No repo code changed on this branch.

Nothing here overlaps `feat/remove-gravity-softening`; that branch's survey material is separate and
lives on that branch. **This request does not touch physics** — see §4.

---

## 1. Where `boostMs` is produced — two independent counters that must stay in step

The metric is a *tick counter* converted to ms at the end. It is computed in **two places** that
must agree exactly, because the server re-derives it from the tape and compares it to the client's
claim:

| site | line | code |
|---|---|---|
| client | `packages/web/src/game/loop.ts:304` | `if (input.boost) boostTicks++;` |
| server | `packages/core/src/replay.ts:249` | `if (input.boost) boostTicks++;` |

Both then `ticksToMs(boostTicks)` (`loop.ts:285`, `replay.ts:284`). The redefinition the owner is
asking for is literally `input.boost` -> `input.boost || input.brake` in both — but the consequences
are not literal, see §2.

Downstream consumers of the value (read-only, no change needed for the metric itself):
`hud/hud.ts:186`, `hud/complete.ts:155,161,215`, `ui/view-models.ts:235-238` (`beatsPersonalBest`),
`ui/screens/levelSelect.ts:25`, `ui/leaderboard/panel.ts:70`, `net/index.ts`, `net/validate.ts:81-87`.
Several of those are in **Worker A's lane** (`ui/**`) — I expect to need none of them.

## 2. What this changes for existing users' saved data and stored scores

This is the part `AGENTS.md` refuses a plan over, so stating it fully rather than deciding it.

**Local personal bests.** `packages/web/src/storage/index.ts:285-294` keeps `boostMs` as a
*minimum*: `boostIsNew = !existing || r.boostMs < existing.boostMs`. Every stored PB was computed
under "boost only". Under the new rule the same run scores **higher or equal** (brake ticks are now
added, never removed). So old PBs become **unbeatable-in-kind records set under a different rule**:
a player who previously used brake heavily has a low stored `boostMs` that their new runs can no
longer match. The value is not corrupted and nothing crashes — it is silently no longer comparable.
There is a `SCHEMA_VERSION` and a migration path already in `storage/index.ts` (lines 29, 214-317),
so a migration *is* possible; whether one is wanted is the owner's call.

**Server scores.** `infra/schema.sql:19` has `check (boost_ms >= 0 and boost_ms <= time_ms)`. That
constraint **still holds** under the new rule: `boostTicks` increments at most once per tick either
way, so `boostMs <= timeMs` is preserved. Good — no schema change forced.

**The real risk is the deploy window, and it is a correctness bug, not a data question.**
`api/score.ts:195-217` runs `verifyReplay` server-side and compares the server's recomputed
`boostMs` against the client's claim with `CLAIM_TOLERANCE_MS = 8` (`api/score.ts:66`) — 8ms is
about one tick. `main` deploys straight to production with no staging gate, and clients cache JS.
So during the rollout:

- **old client + new server:** client claims boost-only ms, server recomputes boost+brake ms. Any
  run with more than ~1 tick of braking mismatches by far more than 8ms -> `boost-mismatch` ->
  `api/score.ts:203-217` **rejects the score outright** (the comment there says reject rather than
  store unverified). Real runs get thrown away.
- **new client + old server:** the mirror image, same rejection.

Both counters live in different deploy units (`replay.ts` is bundled into the client *and* used by
the serverless function), so this window is real. It needs an answer in the plan — versioning the
tape, widening tolerance for a period, or accepting a short window are all live options and I have
not picked one.

**Leaderboard ordering.** `api/_db.ts:150-153,180-189` ranks `metric=efficient` by `boost_ms asc`.
Existing rows were computed boost-only, new rows boost+brake, so the two are ranked against each
other on different definitions — old brake-heavy runs sit permanently above new ones. Migrating
stored rows is impossible without re-verifying every stored tape (the tapes *are* stored —
`_db.ts:108-115` — so a backfill is technically feasible, but there is **no database in this
container**, so I can neither measure how many rows are affected nor test a migration).

## 3. The three surfaces of "flip and burn"

Deliberately separate, per the orchestrator's instruction to say what each does and does not do.

**Flip (render input, driven from `game/loop.ts`).** Rotation comes from `Body.angle`, which
`loop.ts:326` sets each tick via `rocketAngleFromVelocity(player.xVel, player.yVel)` — that is
`atan2(yVel, xVel) + PI/2`, so the ship's nose points **prograde**. The flip is `+ PI` while
braking. Checked against the geometry: the fallback silhouette's nose is at `-y`
(`render/bodies.ts:108`) and its flame is drawn at `+y` (`:116-124`), i.e. the flame is at the tail
and currently points **retrograde**. Adding `PI` puts the nose retrograde and the flame
**prograde — "pointing in the direction of flight"**, exactly the owner's words. So the owner's
phrasing is self-consistent with the existing sprite geometry; no reinterpretation needed.
Does **not** animate the flip (the request says "instant"), does not touch velocity, does not touch
physics. `INTERFACES.md` notes `angle` is cosmetic and excluded from parity traces.

**Flame (render).** `render/bodies.ts:142` picks the sprite via
`sprites.get(body.boostType, body.isBoosting)`; `sprites.ts:83-84` selects from `ROCKET_BOOST_URLS`
vs `ROCKET_URLS`. The flame is not drawn — it is a different texture. So "flame visible while
braking" is `isBoosting || isBraking` at that call site. `Body.isBraking` **already exists** on the
frozen `Body` type and is already set every substep by `applyPlayerInput` (`physics.ts:193`), so
**no frozen file needs to change.** Does **not** add a new sprite, a new asset, or a brake-specific
flame colour — it reuses the existing boost texture, which is what "the flame shall be visible"
asks for and matches the repo's existing pattern.

**Sound (audio).** `loop.ts:504-505` currently calls `opts.audio.setBoost(lastInput.boost)` and
`opts.audio.setBrake(lastInput.brake)`. `AudioSink` (`game/audio.ts:31-38`) already exposes both,
with distinct voices in `audio-voices.ts`. "Same sound as boosting" is a change at the **call site**
in `loop.ts` — drive `setBoost` from `boost || brake` and stop driving the separate brake voice.
Does **not** delete `setBrake` from the `AudioSink` interface (that is a frozen-ish public contract
in `INTERFACES.md` and other callers may exist), and does **not** re-tune any voice in
`audio-voices.ts`.

## 4. Physics: not touched

Stating it explicitly because `AGENTS.md` requires the question be answered either way.
`applyPlayerInput` (`physics.ts:184-240`) is **unchanged** by this request: brake still rescales
speed by `max(0, speed - step)/speed` and boost still rescales by `(speed + step)/speed`. Nothing
here alters a trajectory, so level solvability is untouched and the parity/solvability suites should
stay green. `boostTicks` is bookkeeping in `loop.ts`/`replay.ts`, outside the integrator.
The flip writes `Body.angle`, which nothing in the physics path reads back (`INTERFACES.md`,
"Cosmetic — nothing in the physics path reads `angle` back, and the parity traces exclude it").

## 5. Open questions (need the repo owner)

1. **Existing personal bests** (§2): migrate, invalidate, or leave alone? Leaving them alone means a
   player's own PB is set under a rule their new runs cannot match. I have not assumed.
2. **Existing leaderboard rows** (§2): old rows are boost-only and rank against new boost+brake rows
   on `boost_ms asc`. Backfill by re-verifying stored tapes, wipe, leave, or version the metric?
   I cannot measure the affected row count — **there is no database in this container.**
3. **The deploy window** (§2): old cached clients will have genuine scores *rejected* the moment the
   new server lands, because the claim/recompute tolerance is one tick. Accept, or gate it?
4. **Should the metric be renamed?** It is labelled "Boost used" in the UI (`hud/complete.ts:155`)
   and "boost" on the leaderboard (`ui/leaderboard/panel.ts:70`). Under the new rule it measures
   thrust-time generally. Those strings are in **Worker A's lane** (`ui/**`), so I would not change
   them without both the owner's word and that lane being free.
5. **Boost and brake held together** — currently possible; the tape records them independently.
   One tick counts once either way, so `boostMs <= timeMs` survives, but the owner may want brake
   suppressed while boosting (physics already gives boost priority: the `else if` at
   `physics.ts:212`). Cosmetically it decides whether the ship flips while both are held.
