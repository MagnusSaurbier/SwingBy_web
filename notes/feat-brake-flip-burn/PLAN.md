# Plan — feat/brake-flip-burn

Per AGENTS.md "Change procedure". Survey findings this builds on: `SURVEY.md` (same directory).
All line references below were re-read and confirmed on `feat/brake-flip-burn` at `1b64dc1`.

## What the feature does

1. **Brake counts toward the efficiency metric.** The metric is a tick counter converted to ms at
   the end, incremented in exactly two places that must agree bit-for-bit because the server
   re-derives it from the tape and compares it to the client's claim:
   - client: `packages/web/src/game/loop.ts:304` `if (input.boost) boostTicks++;`
   - server: `packages/core/src/replay.ts:249` `if (input.boost) boostTicks++;`

   Both become "a tick counts if boost **or** brake was held during it". A tick still counts at
   most once, so `boostMs <= timeMs` is preserved and `infra/schema.sql:19`'s
   `check (boost_ms >= 0 and boost_ms <= time_ms)` still holds. No schema change.

2. **Flip.** While braking, the ship is drawn rotated by `body.angle + PI`. Today `angle` is set
   once per tick in the loop (`loop.ts:326`) from `rocketAngleFromVelocity`, so the nose points
   prograde. The fallback silhouette's nose is at `-y` (`render/bodies.ts:108`) and its flame at
   `+y` (`:116-124`), i.e. flame at the tail, currently retrograde. Adding `PI` puts the nose
   retrograde and the flame prograde - "pointing in the direction of flight", which is what braking
   physically is. Instant, no tween.

3. **Burn.** The flame while braking is the existing boost texture: `render/bodies.ts:142`'s
   `sprites.get(body.boostType, body.isBoosting)` becomes `isBoosting || isBraking`, and the
   fallback silhouette's flame polygon draws under the same condition.

4. **Sound.** `loop.ts:504-505` currently drives two voices: `setBoost(lastInput.boost)` and
   `setBrake(lastInput.brake)`. Brake will drive the boost voice: `setBoost(boost || brake)`, and
   the separate brake voice stops being driven.

## Where the flip lives, and why

The flip and the flame both go in **`render/bodies.ts`**, not in the loop. `Body.isBraking` already
exists on the frozen `Body` type and is already set every substep by `applyPlayerInput`
(`physics.ts:193`), and the renderer already receives the whole body from `render/index.ts:170`, so
nothing needs plumbing - `drawPlayer`'s parameter type is a `Pick<Body, ...>` that widens by one
field.

This keeps `angle` meaning exactly what `INTERFACES.md` says it means (direction of travel,
`atan2(yVel,xVel)+PI/2`, cosmetic, excluded from parity traces) and keeps the flip out of the tick
loop entirely, so `verifyReplay` and `predict` are untouched.

## What it deliberately does not do

- **No physics change.** `applyPlayerInput` is not edited; brake still rescales speed by
  `max(0, speed - step)/speed`. No trajectory moves, so level solvability is unaffected. Nothing in
  the physics path reads `angle` back.
- **No frozen file touched** (`types.ts`, `constants.ts`), no `reference/` read or copied.
- **No new asset, no new sprite, no dependency.** The boost texture is reused; audio stays
  procedural via the existing `AudioSink`.
- **No animated flip** - the request says instant.
- **No migration, versioning or backfill** for existing personal bests or leaderboard rows (owner:
  invalidating existing scores is fine, there is no persistent storage for them yet).
- **No re-tuning of any audio voice** in `audio-voices.ts`, and `setBrake` is not removed from the
  `AudioSink` interface (it is a documented contract in `INTERFACES.md`); it simply stops being
  driven by the loop.
- **No UI label change** unless the owner asks for one (see Open questions) - `ui/**` is another
  worker's lane.
- **No editor, HUD, storage, net or api file changed.**

## Surface added

None that is new: no route, no persisted field, no interface change, no new settings key. The
metric keeps its name and type (`boostMs: number` everywhere, `PersonalBest`, `POST /api/score`),
only its definition changes. `drawPlayer`'s parameter type widens by one existing `Body` field.

## What changes for existing users

- **The efficiency metric is redefined.** The same run scores higher or equal than before (brake
  ticks are added, never removed).
- **Old personal bests become non-comparable.** `storage/index.ts:285-294` keeps `boostMs` as a
  minimum, so a previously brake-heavy best is a record the player's new runs cannot match. Accepted
  by the owner; nothing is corrupted and nothing crashes.
- **Old leaderboard rows rank against new ones on different definitions** (`api/_db.ts:150-153`
  orders `metric=efficient` by `boost_ms asc`). Also accepted.
- **Rollout window:** `api/score.ts:195-217` recomputes `boostMs` from the tape and rejects when it
  differs from the client's claim by more than `CLAIM_TOLERANCE_MS = 8` (~one tick). Until a cached
  old client refreshes its JS, a genuine run with more than one tick of braking is rejected with
  `boost-mismatch` (and the mirror case for a new client against an old server). Plan is to accept
  this window and not build a gate - flagged to the owner rather than assumed.

## Files touched

| Path | Change |
|---|---|
| `packages/core/src/replay.ts` | brake counts toward `boostTicks` |
| `packages/web/src/game/loop.ts` | brake counts toward `boostTicks`; boost voice driven by `boost \|\| brake` |
| `packages/web/src/render/bodies.ts` | flip by `PI` while braking; boost flame/texture while braking |
| `packages/core/test/replay/verify.test.ts` | tests below |
| `packages/web/test/loop.test.ts` | tests below |
| `packages/web/src/render/bodies.test.ts` | tests below |
| `notes/feat-brake-flip-burn/*`, `notes/agent-status/feat/brake-flip-burn.md` | plan and log |

Nothing outside those. `git diff --name-only` is checked before each commit.

## Blast radius

- Consumers of `boostMs` are read-only and need no change: `hud/hud.ts:186`, `hud/complete.ts:155`,
  `ui/view-models.ts:235-238` (`beatsPersonalBest`), `ui/screens/levelSelect.ts:25`,
  `ui/leaderboard/panel.ts:70`, `net/**`, `api/score.ts`.
- The two counters are the risk: if only one is changed, every submitted score is rejected. They are
  changed in the same commit and covered by a test on each side.
- Existing suites that could notice: `packages/core/test/replay/verify.test.ts` (any fixture that
  brakes now yields a larger `boostMs`), `packages/web/test/loop*.test.ts`,
  `packages/web/src/render/bodies.test.ts` (the "rotates by body.angle" case stays valid because it
  is not braking), `packages/web/test/hud*.test.ts` (formatting only). Whatever turns red gets read
  and fixed as a consequence of the redefinition, not weakened.
- Parity and solvability suites: unaffected, nothing in the integrator changes.

## Alternatives considered

- **Count brake into a separate `brakeMs` and sum at display time.** Rejected: it adds a persisted
  field and a second definition of the metric across client, server, schema and API, for no
  behavioural difference.
- **Do the flip in the loop by adding `PI` to `player.angle`.** Rejected: it makes `angle` mean
  something other than direction of travel, contradicting the `INTERFACES.md` contract, and the
  flame change would still need the renderer.
- **Mutate `body.isBoosting` while braking so the sprite picks itself.** Rejected: it lies in shared
  simulation state that `physics.ts` rewrites every substep.
- **A brake-specific flame colour or sprite.** Rejected: the request says the same burn and the same
  sound; a new asset also costs bundle budget.

## Tests, and why they fail without the change

Failing-first output is recorded in `notes/feat-brake-flip-burn/log.md` before the fix.

1. `packages/core/test/replay/verify.test.ts` - a tape that only brakes for N ticks verifies with
   `boostMs === ticksToMs(N)`. Fails today: `boostMs === 0`.
2. Same file - boost and brake held on the same tick counts that tick **once**
   (`boostMs <= timeMs` must survive). Fails today by counting differently.
3. `packages/web/test/loop.test.ts` - a session where brake is held for N ticks reports
   `boostMs === ticksToMs(N)` in the `onComplete` payload, and the client value equals what
   `verifyReplay` recomputes from the same tape (the two counters agree). Fails today: 0 vs client.
4. `packages/web/src/render/bodies.test.ts` - braking rotates by `angle + PI` (asserted on the
   `rotate` arg) and draws the flame polygon; **not** braking and **not** boosting draws neither
   (the refusal case). Fails today: rotate arg is `angle`, no flame.
5. `packages/web/test/loop.test.ts` - the audio sink records `setBoost(true)` while only brake is
   held, and the brake voice is never switched on. Fails today: `setBoost(false)`.

Audio cannot be listened to in this container, so the audio assertion is on the sink call, not on
sound.

## Verification matrix

| Gate | How |
|---|---|
| `npm run typecheck` | exit code + output |
| `npm test` | full suite, pass/fail counts before and after |
| `npm run lint` | exit code |
| `npm run build -w @swingby/web` | exit code |
| `npm run size` | gzipped KB against the 250 KB budget, before and after |
| flip-and-burn visual | Playwright + Chromium (preinstalled, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, never `playwright install`), screenshots of idle vs braking |
| audio | **not verifiable** - no audio device; asserted on the synth trigger/graph instead, and stated as such in the PR |

## Open questions for the owner

1. **Metric label.** The UI says "Boost used" (`hud/complete.ts:155`) and "Boost <time>" live
   (`hud/hud.ts:186`); the leaderboard column says boost (`ui/leaderboard/panel.ts:70`). Under the
   new rule it measures thrust time generally. Rename (e.g. "Thrust used") or leave? Those strings
   are in another worker's `ui/**` lane, so I would only change them on the owner's word.
2. **Boost and brake held together.** Physics gives boost priority (`physics.ts:212` `else if`), so
   brake has no velocity effect while boost is down. Proposed: the tick counts once, boost wins
   visually and audibly (no flip, boost flame, boost sound). Confirm or invert.
3. **Rollout window** (above): accept the short window in which an old cached client's genuine
   braking run is rejected, or widen `CLAIM_TOLERANCE_MS` temporarily? Proposed: accept, change
   nothing in `api/`.
