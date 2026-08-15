# T-12 LEDGER — results

**Status: done-pending-database.** Every route, every validation/rate-limit/verification rule, and
the schema are implemented, tested, and internally proven. `infra/schema.sql` was applied to a real
local Postgres 16 (not mocked) and its indexes proven with real `EXPLAIN ANALYZE` output at two data
volumes. But **no route in this codebase has ever executed end-to-end against `@neondatabase/serverless`'s
real HTTP driver, and nothing here has ever talked to Neon** — this container has no Neon account, no
`DATABASE_URL`, and no network path to Neon. See "BLOCKED — needs a real database" at the bottom for
exactly what that leaves for Magnus. Read that section before treating this as fully shipped.

## Deliverables

| # | Artifact | Path | Status |
|---|---|---|---|
| 1 | Six routes matching the frozen contract | `api/leaderboard.ts`, `api/score.ts`, `api/levels/index.ts`, `api/levels/[id].ts` | Done |
| 2 | Schema | `infra/schema.sql` | Done, applied to a real local Postgres 16 (twice, proving idempotency) — **never applied to Neon** |
| 3 | Shared db helper (HTTP driver) and input validation | `api/_db.ts`, `api/_validate.ts` | Done — `_db.ts`'s production path (`getSql()` → `neon()`) is untested against a real Neon endpoint (see BLOCKED) |
| 4 | Rate limiting | `api/_ratelimit.ts` | Done — in-memory, with an explicitly documented distributed-source limitation (see "Rate limiting" below) |
| 5 | Integration tests | `api/test/**` (8 files, 114 tests) | Done — against an honest in-memory `QueryFn` fake (`api/test/support/fake-db.ts`), **not** the real Neon driver |
| 6 | `EXPLAIN` output for both leaderboard queries | This file, "Index usage — real `EXPLAIN ANALYZE`" | Done, from a **local Postgres 16 scratch database**, not Neon |
| 7 | Measured cold start and verification time | This file, "Measured numbers" | Verification time: done, measured for real. Cold start: **BLOCKED**, no real serverless deployment available |

Also: `api/test/sql/seed-and-explain.sql` (reproducible seed + EXPLAIN script, mine to own under
`api/test/**`) and `notes/T-12-LEDGER/log.md` (full working log, decisions, and two dead ends ruled
out with root causes, not just patched over).

## Definition of done

| Item | Status | Reason |
|---|---|---|
| All routes match the frozen contract in INTERFACES.md exactly | ✅ | Response shapes checked field-by-field against `INTERFACES.md#api--t-12-ledger` while writing each route; every field name (`rank`, `timeMs`, `boostMs`, `verified`, `createdAt`, `accepted`, `reason`, `id`, `name`, `author`, `plays`, `data`) matches literally. |
| A genuine tape from a real playthrough submits and verifies | ✅ | All 33 of T-03's real solving tapes: **33/33 accepted, `verified: true`**. See "Forgery accept/reject counts" below. |
| **A tampered tape (one flipped index) is rejected** | ✅ | Two independent tamper classes, both fully rejected where applicable — see below. Zero cases where a tamper that actually changed the outcome was accepted. |
| A claimed time that does not match the replay is rejected | ✅ | +500ms inflated claim: **33/33 rejected**, `reason: "time-mismatch"`. |
| Unverified entries never outrank verified ones, at any value | ✅ | Proven at both the DB-query layer (`api/test/_db.test.ts`) and the HTTP-response layer (`api/test/leaderboard.test.ts`) with an unverified 1ms row and a verified 50,000ms row on the same level — verified row ranks #1 regardless. |
| Leaderboard queries use the indexes — `EXPLAIN` output pasted, not asserted | ✅ (local Postgres, not Neon) | Real `EXPLAIN ANALYZE` at 302 rows and 200,302 rows for one level — see below. Index Scan, not sequential scan, at both volumes. |
| Rate limiting demonstrably works (show it triggering) | ✅ (logic proven; never exercised over real HTTP) | 8/60s threshold; 12 requests → 8 allowed / 4 rejected; 50-in-10s scenario → 8 allowed / 42 rejected (429-equivalent). See below. |
| Oversized and malformed payloads rejected **before** any simulation runs | ✅ | Raw-byte-stream cap (`readJsonBody`) rejects before `JSON.parse`; shape/bounds checks in `_validate.ts` reject before `resolveLevel`/`verifyReplay`. Hostile-input table below, with a `queryLog` assertion proving the database was never even touched for the reject-before-DB cases. |
| Custom level bodies validated through T-03's `validate` before storage | ✅ | `api/levels/index.ts`'s `buildLevelToStore` calls `@swingby/core`'s real `validate()`; a level missing a player object is rejected with the validator's own error text. |
| Cold start **< 1 s**, verification **< 100 ms** — report both | ⚠️ partial | Verification: **measured, real, comfortably under budget** (see below). Cold start: **not measured — BLOCKED**, no real serverless runtime available in this container. |
| Secrets in environment variables only; `git log -p` shows no connection string ever committed | ⚠️ unverifiable by me | `DATABASE_URL` is read from `process.env` only (`api/_db.ts`'s `getSql()`); grepped every file I wrote for `postgres://`/`postgresql://` and the local scratch password — zero matches. I cannot run `git log -p` (git is the orchestrator's, per this session's hard rules) so the historical-commit half of this check is unverified by me. |
| Global checklist (PROJECT.md §7) | ✅ (for my files) | See "Verification" below for the actual commands and output. |

## Security posture — what's actually enforced, and where

- **Never trust the claimed score.** `api/score.ts`'s stored row always uses `result.timeMs`/
  `result.boostMs` (the server's own recomputed values from `verifyReplay`), never
  `parsed.timeMs`/`parsed.boostMs` (the claim). Proven directly: a claim nudged +3ms within
  tolerance is accepted, but the row stores the exact server-computed value, not the nudged claim
  (`api/test/score.test.ts` > "never stores the client's claimed value verbatim...").
- **Every query is parameterized.** No request-derived value is ever composed into SQL text —
  including values already checked against an allowlist (`metric`, `sort`). Each query that varies
  by one of those allowlisted values is written as a complete, separate literal string per branch in
  `api/_db.ts` (`leaderboardQuery`, `rankVerifiedQuery`, `rankUnverifiedQuery`, `listLevelsQuery`) —
  zero string interpolation of any kind into a SQL string, anywhere.
- **Bounded before work runs.** Raw request bytes are capped before `JSON.parse` even runs
  (`readJsonBody`, opting out of Vercel's platform body parser via `export const config = { api: {
  bodyParser: false } }`); tape shape/size and level object count are checked before `resolveLevel`
  or `verifyReplay` run at all.
- **Rate limiting** — see its own section below; the threshold and its honest limitation.
- **`name` is sanitized on input** (control characters stripped, length-capped at 24 for scores / 48
  for level names / 32 for level authors) because it is rendered by T-13. SQL metacharacters are
  deliberately **not** stripped — the parameterized query is the injection defense; character
  filtering would be a second, weaker, redundant defense that could also mangle a legitimate name
  like `O'Brien`. Proven: a 24-char SQL-injection-shaped name round-trips byte-for-byte into the
  stored row, and the (fake) database is unharmed by construction (it only ever receives it as a
  bind parameter).

## Forgery accept/reject counts (all 33 real T-03 solving tapes)

| Scenario | Result |
|---|---|
| Genuine tape, genuine claim | **33/33 accepted**, `verified: true` |
| Genuine tape, claim inflated by +500ms | **33/33 rejected**, `reason: "time-mismatch"` |
| Claim within the 8ms rounding tolerance (+6ms) | Accepted (single-case check) |
| Claim just outside the tolerance (+9ms) | Rejected (single-case check) |
| Tampered tape — one transition index flipped (±25 ticks, falling back to ±1) | **22 of 33 tapes had a transition to flip at all** (11 of the 33 solve by pure coasting — both `boost` and `brake` are empty arrays, nothing to flip; see below). Of the 22 flippable: **22/22 rejected**, and independently re-verified that **0** of them were accepted-while-the-real-outcome-actually-changed (the only case that would be an actual forgery bypass). |
| Tampered tape — tick count shaved by one (T-02's own proven method, reused for the pure-coast tapes flipping can't touch) | **33/33 rejected**, `reason: "no-goal"` |
| Empty tape (`ticks:0, boost:[], brake:[]`) | Rejected, `reason: "no-goal"` |

**The "22 of 33 flippable" number is not a gap — it's a fact about the corpus.** 11 of the 33 real
solving tapes reach their goal by pure coasting: the ship is launched with exactly the right initial
velocity and needs zero boost/brake input at all (`boost: []` and `brake: []` both, confirmed by
reading every one of the 33 tape files directly). There is no transition index in an empty array to
flip. The tick-truncation tamper class covers those 11 (and, redundantly but for free, the other 22
too), so **every one of the 33 real tapes has at least one proven forgery-rejection data point**, via
one tamper class or the other.

**Why "22/22 rejected, 0 accepted-with-changed-outcome" is the precise claim, not "22/22 tampers
always break the run."** A single-tick (±1) nudge to a control's timing is sometimes fully absorbed
by the physics with zero effect on which tick the goal is captured — physics is not maximally
chaotic at every instant. When that happens, accepting the "tampered" tape is *correct*, not a bug:
the claim still matches what actually happened, because what actually happened didn't change. The
real security property — proven, not assumed — is that **a tamper which changes the real simulated
outcome is never accepted**: each of the 22 "accepted" candidates was independently re-probed with
`verifyReplay` itself (not by trusting `handleScore`'s own verdict) and 0 of them had a changed
outcome; every one of the 22 flippable tapes here was in fact **rejected outright** (the ±25-tick
delta used, preferred over ±1, was large enough to move the outcome in every one of the 22 cases that
had a transition to move).

## Hostile-input table

| Input | What happened | Where it's stopped |
|---|---|---|
| Tape with >2000 transitions | 400, `reason: "invalid-tape"` | `_validate.ts` shape check, before any DB call (`queryLog` empty) |
| `ticks` over the 10-minute cap (144×600+1) | 400, `reason: "invalid-tape"` | same |
| `NaN` in `timeMs` | 400, `reason: "invalid-time-ms"` | `isFiniteNumberInRange` (guards `Number.isFinite` explicitly — a naive `Math.abs(a - NaN) > tol` is always `false` in JS, which would silently PASS a forged claim) |
| `Infinity` in `boostMs` | 400, `reason: "invalid-boost-ms"` | same guard |
| `boostMs > timeMs` | 400, `reason: "boost-exceeds-time"` | cheap pre-check; also mirrored as a DB-level `CHECK` constraint in `infra/schema.sql` |
| SQL metacharacters in `name` (`R'); DROP TABLE score;--`) | **Accepted** — stored verbatim as a bind parameter | Not a rejection case by design; parameterization is the defense, not filtering (see "Security posture") |
| SQL metacharacters in `levelId` (score submission or leaderboard/level lookup) | 400, `reason`/`error: "invalid-level-id"` | Character-set allowlist regex, before any DB call |
| SQL metacharacters in `metric` | 400, `"invalid-metric"` | Exact-literal allowlist (`"fastest" \| "efficient"`, nothing else) |
| SQL metacharacters in `sort` | Falls back to default (`"new"`), 200 | Exact-literal allowlist; an unrecognized value degrades to the default rather than erroring, since sort order isn't security-sensitive |
| 10 MB level payload | Rejected, `"too-large"`, before `JSON.parse` runs | `readJsonBody`'s raw-byte-stream cap (proven directly against a real ~10.5 MB in-memory buffer, never committed to disk, plus separately via a lying `Content-Length` header) |
| `objects.length` = 10,000 (the DoS shape) | 400, `"too-many-objects"` | Cheap `.length` check before `@swingby/core`'s `validate()` ever runs, before any DB call |
| Level with no player object | 400, `"invalid-level: exactly one player object is required..."` | `@swingby/core`'s real `validate()` |
| Empty tape encoding (`tape: ""`) | 400, `"invalid-tape"` | Shape check rejects a non-object `tape` |
| Truncated tape (missing `brake` field) | 400, `"invalid-tape"` | same |
| Negative `ticks` | 400, `"invalid-tape"` | same |
| Oversized `name`/`author`/level `name` | **Accepted, truncated** to the field's cap (24 / 32 / 48 chars) rather than rejected | `sanitizeName` |
| Empty/whitespace-only `name` | 400, `"invalid-name"` | `sanitizeName` returns `null` |
| Malformed top-level body (a bare string, not an object) | 400, `"malformed-body"` | `isPlainObject` guard |
| Unresolvable but well-formed `levelId` | 404, `"level-not-found"` | `resolveLevel` returns `null` |

## Rate limiting

**Threshold:** 8 requests / 60 seconds per source IP for `POST /api/score`; 5 requests / 60 seconds
for `POST /api/levels` (`SCORE_RATE_LIMIT`, `LEVEL_RATE_LIMIT` in `api/_ratelimit.ts`). Sliding
window, not fixed-bucket (old hits age out continuously, not all at once).

**Proven triggering** (`api/test/_ratelimit.test.ts`, `api/test/score.test.ts`):
- 12 requests from one IP inside the window → **8 allowed, 4 rejected**.
- The task's own literal scenario, "fire 50 submissions in 10s" → **8 allowed, 42 rejected**
  (429-equivalent — `RateLimitResult.allowed === false`), against the actual configured
  `scoreRateLimiter` singleton, not a fresh test-only instance.
- A different source IP is unaffected once one IP is limited (independent per-key budgets).
- Old hits age out of the sliding window and free up budget without waiting for a hard reset.
- Distinct-key tracking is capped (`maxTrackedKeys`, default 10,000) with oldest-key eviction, so a
  low-rate scan across many distinct source IPs cannot grow the tracked-state map without bound.

**Failure mode under a distributed source — stated plainly, per the task's instruction not to
hide this behind an adjective:** this is an **in-memory, single-warm-instance** counter. There is no
Redis/Vercel KV/other shared store available (`api/package.json` is T-14 LAUNCHPAD's file; adding a
dependency there is a request this task can make, not something it can do unilaterally). Two
concrete consequences:
1. A cold start resets that instance's counter to zero. This costs an attacker nothing extra to
   exploit (they'd have to *cause* a cold start, which is itself more expensive than the requests
   they'd save), so it is a minor, not a serious, leak.
2. **Vercel can run multiple instances of the same function concurrently under load.** Each gets an
   independent counter. A genuinely distributed source (many source IPs, or simply enough concurrent
   traffic to spin up several warm instances) has an *effective* ceiling of the configured limit
   **multiplied by however many instances happen to be concurrently warm** — not a hard global cap.

What this correctly stops: a single script hammering the endpoint from one source within one warm
instance's lifetime — the realistic "someone left a loop running" case for a personal-site
leaderboard. It does **not** stop a real botnet. Closing that gap needs a shared store (Vercel
KV/Upstash Redis, or the database itself with an `ip`/window column) — named here as a follow-up, not
implemented, because it needs a new dependency in a file this task doesn't own.

**Also never exercised over a real HTTP round-trip** — this container has no `vercel dev` and no
network path to test a live server, so "shows it triggering" here means the exact configured
limiter object rejecting calls in a unit test, not a `curl` loop hitting `429`. The logic under test
is identical to what the route handler calls (`scoreRateLimiter.check(ip)` in `api/score.ts`), just
not invoked through an actual server process.

## Measured numbers

All measured in this container: Node v22.22.2, npm 10.9.7, `npx vitest run`.

- **Test pass/fail:** `npx vitest run api/test` → **114 passed, 0 failed** (8 test files:
  `_validate`, `_ratelimit`, `_db`, `score`, `leaderboard`, `levels`, `perf`, `fixtures`).
- **Repo-wide, to confirm nothing else was broken:** `npx vitest run` (no path filter) →
  **599 passed, 1 skipped** (30 files) — the 1 skip is T-01 KEPLER's known Godot-parity gate,
  unrelated to this task.
- **`npm run typecheck`:** clean for every file under `api/**` (confirmed both by the absence of any
  `api/` line in the output AND by deliberately injecting a real type error into `api/_db.ts` and
  confirming `tsc` caught it, then removing the probe — so "no output" here means "actually checked
  and passed," not "silently skipped due to a stale build cache").
- **`npm run lint`:** clean for every file under `api/**` (0 matches for `api/` in `prettier --check
  .`'s warning list; `infra/schema.sql` is outside prettier's directory walk entirely — it has no
  built-in SQL parser and silently skips extensions it doesn't recognize when walking a directory,
  confirmed by contrast with the explicit-path form, which does error).
- **Verification time, measured through the real route (`handleScore`), not `verifyReplay` in
  isolation** (own fixture — see `api/test/perf.test.ts`'s header comment for why a first attempt at
  this fixture failed its own built-in sanity check and had to be redesigned):
  - 60s / 8,640-tick worst case (never reaches goal, so the full tape always simulates): across
    several runs of the suite, **min as low as 6.3ms, avg 11–24ms, max 6.3–56.0ms** — every run
    comfortably under the task's stated **< 100ms** budget. (Range reflects this container sharing
    CPU with other agents' concurrent sessions during this run, not test flakiness — see
    notes/T-12-LEDGER/log.md.)
  - Full 10-minute / 86,400-tick cap (`MAX_TAPE_TICKS`, ~10× the tick count above): **min 63–78ms,
    avg 64–118ms, max 65–160ms** across runs. No hard budget is asserted for this one — the task's
    100ms figure is specifically for a 60s tape — reported as a number, and still comfortably under
    1 second even at the absolute largest tape this route will ever be asked to simulate.
  - Consistent in order of magnitude with T-02 TAPE's own isolated `verifyReplay` measurement for
    the same 60s tick count (avg 6.47ms / max 17.95ms, see `results/T-02-TAPE.md`) — the modest
    delta is this route's own overhead (`resolveLevel`'s lookup) on top of the identical physics.
- **Cold start: not measured.** No real Vercel serverless runtime is reachable from this container.
  Qualitatively (not a substitute for a measurement, stated only as engineering intent): `getSql()`
  is lazy (no top-level `neon()` call, no connection opened until the first query), the route
  modules import only `@swingby/core` and `@neondatabase/serverless`, no heavy top-level work runs
  at import time. See "BLOCKED" below.

## Index usage — real `EXPLAIN ANALYZE`

**Run against a local Postgres 16 scratch database in this container** (`swingby_test` / `swingby`
role), **not Neon** — no Neon account or network path exists here. This is real Postgres, not a
mock, and the query text is byte-for-byte what `api/_db.ts`'s `leaderboardQuery()` /
`listLevelsQuery()` emit — but it is not proof the same plan holds on Neon's infrastructure, which
has its own storage layer and connection model. See "BLOCKED" for what Magnus still needs to run.

Reproducible via `psql -h <host> -U <user> -d <db> -f api/test/sql/seed-and-explain.sql` (the exact
script that produced everything below).

**At moderate volume (302 rows for `builtin-00`, 12,002 rows total across 40 levels):**

```
=== EXPLAIN ANALYZE: metric=fastest ===
 Limit  (cost=0.29..5.96 rows=50 width=36) (actual time=0.041..0.079 rows=50 loops=1)
   ->  WindowAgg  (cost=0.29..1009.54 rows=8890 width=36) (actual time=0.040..0.074 rows=50 loops=1)
         ->  Index Scan using score_level_verified_time_idx on score  (cost=0.29..853.97 rows=8890 width=28) (actual time=0.035..0.053 rows=50 loops=1)
               Index Cond: (level_id = 'builtin-00'::text)
 Planning Time: 0.185 ms
 Execution Time: 0.114 ms

=== EXPLAIN ANALYZE: metric=efficient ===
 Limit  (cost=0.29..5.96 rows=50 width=36) (actual time=0.018..0.052 rows=50 loops=1)
   ->  WindowAgg  (cost=0.29..1009.54 rows=8890 width=36) (actual time=0.017..0.047 rows=50 loops=1)
         ->  Index Scan using score_level_verified_boost_idx on score  (cost=0.29..853.97 rows=8890 width=28) (actual time=0.015..0.029 rows=50 loops=1)
               Index Cond: (level_id = 'builtin-00'::text)
 Planning Time: 0.052 ms
 Execution Time: 0.065 ms
```

Both are a direct ordered `Index Scan` already, with no separate `Sort` node — Postgres's planner
had enough statistics at this point to know the composite index satisfies `ORDER BY verified DESC,
time_ms/boost_ms ASC` directly. (An earlier run at this same row count, before an autovacuum/ANALYZE
cycle had run, instead showed a `Bitmap Heap Scan` + explicit in-memory `Sort` — also correct, and
also fast at this row count: sorting ~300 rows costs nothing either way. Plan choice depending on
table statistics timing is a real, normal Postgres behavior, not a bug in the index design — the
proof that matters is the high-volume case below, where the choice stops being a toss-up.)

**At high volume — 200,302 rows, all on the single level `builtin-00`** (added specifically to make
the composite index's benefit unambiguous, since a real popular level accumulates far more rows than
40-levels-at-300-each ever will):

```
=== EXPLAIN ANALYZE at 200,302 rows: metric=fastest ===
 Limit  (cost=0.42..5.22 rows=50 width=36) (actual time=0.034..0.104 rows=50 loops=1)
   ->  WindowAgg  (cost=0.42..15025.35 rows=156650 width=36) (actual time=0.033..0.099 rows=50 loops=1)
         ->  Index Scan using score_level_verified_time_idx on score  (cost=0.42..12283.98 rows=156650 width=28) (actual time=0.026..0.077 rows=50 loops=1)
               Index Cond: (level_id = 'builtin-00'::text)
 Planning Time: 0.129 ms
 Execution Time: 0.127 ms

=== EXPLAIN ANALYZE at 200,302 rows: metric=efficient ===
 Limit  (cost=0.42..4.93 rows=50 width=36) (actual time=0.023..0.093 rows=50 loops=1)
   ->  WindowAgg  (cost=0.42..14145.35 rows=156650 width=36) (actual time=0.023..0.089 rows=50 loops=1)
         ->  Index Scan using score_level_verified_boost_idx on score  (cost=0.42..11403.98 rows=156650 width=28) (actual time=0.020..0.071 rows=50 loops=1)
               Index Cond: (level_id = 'builtin-00'::text)
 Planning Time: 0.059 ms
 Execution Time: 0.108 ms
```

**The proof that matters:** the planner's own cost estimate shows ~156,650 candidate rows for that
level, but `actual ... rows=50` at every node — real, measured evidence of early termination via
`LIMIT`, not just a plan that theoretically could stop early. Both queries execute in **~0.1–0.13ms**
against 200k+ rows for that level. No sequential scan anywhere, at either data volume.

**`custom_level` list queries** (`GET /api/levels?sort=new|top`), 500 rows:

```
=== sort=new ===
 Limit  (cost=0.28..2.84 rows=20 width=39) (actual time=0.009..0.025 rows=20 loops=1)
   ->  Index Scan using custom_level_created_at_idx on custom_level (actual time=0.008..0.023 rows=20 loops=1)
 Execution Time: 0.034 ms

=== sort=top ===
 Limit  (cost=0.28..2.84 rows=20 width=39) (actual time=0.010..0.026 rows=20 loops=1)
   ->  Index Scan using custom_level_plays_idx on custom_level (actual time=0.010..0.023 rows=20 loops=1)
 Execution Time: 0.037 ms
```

**Verified-first invariant, visible in real query output** (not just plan shape) — top 5 rows for
`builtin-00`/fastest after seeding, all genuinely verified, ordered correctly by `time_ms`:

```
 player_name | time_ms | boost_ms | verified
-------------+---------+----------+----------
 heavy19541  |    1000 |      281 | t
 heavy94339  |    1000 |      244 | t
 heavy114283 |    1000 |      145 | t
 heavy143467 |    1000 |      148 | t
 heavy188471 |    1000 |      224 | t
```

**Full `EXPLAIN` statements, exactly as they should be re-run against Neon** (also committed as
runnable SQL at `api/test/sql/seed-and-explain.sql`):

```sql
explain analyze
select player_name, time_ms, boost_ms, verified, created_at,
       row_number() over (order by verified desc, time_ms asc) as rank
from score
where level_id = 'builtin-00'
order by verified desc, time_ms asc
limit 50;

explain analyze
select player_name, time_ms, boost_ms, verified, created_at,
       row_number() over (order by verified desc, boost_ms asc) as rank
from score
where level_id = 'builtin-00'
order by verified desc, boost_ms asc
limit 50;
```

## Schema design — why the indexes diverge from the task doc's illustrative SQL

`tasks/T-12-LEDGER.md`'s "Schema" section shows `create index on score (level_id, time_ms)` /
`(level_id, boost_ms)`. `infra/schema.sql` instead uses `(level_id, verified desc, time_ms)` /
`(level_id, verified desc, boost_ms)`. This is a deliberate change, not a drift: the *actual* query
this task must run is never `ORDER BY time_ms` alone — it's always `ORDER BY verified DESC,
time_ms ASC`, because "unverified must never outrank verified" (INTERFACES.md) is not optional. The
literal two-column index cannot serve that `ORDER BY` without an extra sort step once row counts
grow past what fits in a trivial in-memory sort; the three-column version can, and the high-volume
`EXPLAIN` above is the direct proof. `schema.sql` is this task's own file to design (only the six
routes' request/response *shapes* are frozen in INTERFACES.md, not the schema), so this is in scope.
Also added, beyond the task doc's literal SQL: `CHECK` constraints mirroring the application-level
bounds (`boost_ms <= time_ms`, name/author length caps) as defense-in-depth, and `IF NOT EXISTS` /
idempotent `CREATE` statements throughout so the file can be safely re-run.

## Verification-failure policy — reject, don't store unverified (a deliberate reading of "may")

The task doc allows either "store with `verified: false`" or "reject outright" on a verification
failure. This implementation always rejects outright (no DB write) for every `verifyReplay` failure
reason — matching the DoD checklist's own wording, which phrases every failure case as "is
rejected," and avoiding DB bloat from adversarial junk submissions. The `verified` column and the
verified-first ranking logic are still fully implemented and tested as a DB-level invariant
(`api/test/_db.test.ts`, `api/test/leaderboard.test.ts` both insert a synthetic unverified row
directly and prove it can never outrank a verified one) — because a plausible future write path
(e.g. bulk-importing `DataManager.gd`'s legacy local `scores.json`, which DESIGN.md §5 names
directly) would produce exactly such rows without going through this route at all, and the
invariant needs to hold regardless of which code path produced the row. Flagged as an assumption in
notes/T-12-LEDGER/log.md for review — the interface language ("may be stored... but never outrank")
reads as though storing unverified rows is an anticipated real scenario, and this implementation's
stricter choice is a considered judgment call, not an oversight.

## Fail-proof demonstration

Temporarily replaced the `verifyReplay(...)` call in `api/score.ts` with a stub literal
(`{ ok: true, timeMs: parsed.timeMs, boostMs: parsed.boostMs, ... }`) — every submission trusted
unconditionally, claim echoed straight through with zero recomputation.

**`npx vitest run api/test` with the stub in place: 11 failed / 103 passed (114 total), 2 files
affected.** Every failure is exactly where it should be — not one lucky assertion carrying the whole
demonstration, but eleven independent ones:

```
FAIL api/test/score.test.ts > ... > never stores the client's claimed value verbatim ...
FAIL api/test/score.test.ts > ... > rejects a tampered tape (one flipped transition index) ...
FAIL api/test/score.test.ts > ... > rejects a tampered tape across ALL 33 levels ...
FAIL api/test/score.test.ts > ... > rejects a truncated tape (ticks shaved by one) across ALL 33 levels ...
FAIL api/test/score.test.ts > ... > rejects a claimed time that does not match the replay (+500ms) ...
FAIL api/test/score.test.ts > ... > rejects a +500ms inflated claim across all 33 levels
FAIL api/test/score.test.ts > ... > rejects a claim just outside the tolerance
FAIL api/test/score.test.ts > ... > rejects a tape that never reaches the goal (empty tape)
FAIL api/test/perf.test.ts  > ... > resolves PERFBENCH1 via a custom-level row ...
FAIL api/test/perf.test.ts  > ... > measures a 60s (8,640-tick) worst-case submission ...
FAIL api/test/perf.test.ts  > ... > measures the full 10-minute (86,400-tick) cap ...

Test Files  2 failed | 6 passed (8)
     Tests  11 failed | 103 passed (114)
```

(The two `perf.test.ts` failures are a bonus, unplanned proof-of-robustness: that benchmark has its
own internal sanity assertion — "this fixture must always report `no-goal`" — which correctly
refused to report a timing number at all once verification could no longer ever reject anything,
rather than silently reporting a now-meaningless number.)

**Reverted** by restoring the original `verifyReplay(...)` call (typed from memory of what was
removed, then checked against this log's own record of the surrounding lines — not a blind
copy-paste undo). `npm run typecheck`: clean. `npm run lint`: clean for `score.ts`. `npx vitest run
api/test`: **back to 114/114 passed, 8 files**, confirmed on a fresh run.

## Verification — the actual commands run

```bash
npm run typecheck                        # 0 errors under api/**
npm run lint                              # 0 warnings under api/**
npx vitest run api/test                   # 114 passed, 0 failed (8 files)
npx vitest run                            # 599 passed, 1 skipped, repo-wide (30 files)
grep -rn "postgres://\|postgresql://" api/ infra/schema.sql notes/T-12-LEDGER/   # no matches
```

Database work (this container's local scratch Postgres, not part of `npm test`):

```bash
pg_ctlcluster 16 main start
psql -h localhost -U swingby -d swingby_test -f infra/schema.sql               # applies cleanly
psql -h localhost -U swingby -d swingby_test -f infra/schema.sql               # re-run: idempotent, NOTICE + skip
psql -h localhost -U swingby -d swingby_test -f api/test/sql/seed-and-explain.sql   # seeds + EXPLAIN ANALYZE, output above
```

## BLOCKED — needs a real database

Nothing below can be done inside this container. Everything above it is real work, independently
verifiable by re-running the commands in "Verification," but it stops short of proving this system
works against the actual production stack (Vercel + Neon + `@neondatabase/serverless`'s HTTP
driver). Specifically, Magnus needs to:

1. **Provision Neon.** Create a project at console.neon.tech (DESIGN.md §8 already covers why Neon
   specifically — connection-pool exhaustion from serverless concurrency over raw TCP). Copy the
   HTTP-driver-compatible connection string.
2. **Set `DATABASE_URL`** in the Vercel project's environment variables (Production, Preview, and
   Development scopes — `infra/DEPLOY.md` §5, already written by T-14, covers the exact steps).
   **Never commit this value.**
3. **Apply `infra/schema.sql` to the real Neon database** — `psql "$DATABASE_URL" -f
   infra/schema.sql`, or paste it into Neon's SQL editor. It applied cleanly and idempotently to a
   local Postgres 16 in this container, but Postgres-compatible is not the same claim as
   "actually applied to Neon" — that step has never run.
4. **Re-run the exact `EXPLAIN ANALYZE` queries against Neon**, ideally after seeding a comparable
   row count — `api/test/sql/seed-and-explain.sql` is written to be re-run as-is against any
   Postgres-wire-compatible target, Neon included. The local-Postgres numbers above are believed
   representative (same query planner family, same index structure) but Neon's storage layer and
   network path are different enough that this is a claim to verify, not assume.
5. **Deploy to Vercel and measure real cold start** — first request after idle, budget < 1s per the
   task doc. Nothing in this container can produce that number; the only thing offered here is the
   structural argument (lazy `getSql()`, minimal import graph) for why it's *expected* to be fast,
   which is not a substitute for measuring it.
6. **Exercise the real HTTP driver end-to-end** — every test in `api/test/**` runs against an
   honest in-memory `QueryFn` fake (`api/test/support/fake-db.ts`), independently re-implementing
   the same filter/sort/limit/uniqueness semantics a real Postgres enforces, specifically so route
   logic is proven without needing a live database. It is deliberately NOT a substitute for actually
   calling `neon(url)` and hitting a real endpoint — that call path (`getSql()` in `api/_db.ts`) has
   a single, narrow, direct test only for its error path (throws `DbConfigError` when
   `DATABASE_URL` is unset, which is this container's actual, honest state) and has never
   successfully completed a real query.
7. **`vercel dev` / a live HTTP round-trip for rate limiting** — the rate-limiter logic is unit
   tested directly against the exact configured singleton the route calls, but no `curl` loop
   against a running server has ever produced a real `429` here.
8. **The historical-commit half of the "no secrets ever committed" check** — `git log -p -- api/
   infra/ | grep -i "postgres://"` needs to be run by whoever has git access in this session (the
   orchestrator, per this session's hard rules); I verified the current file contents are clean but
   cannot check history.

Report this task as **done-pending-database**, not done. Everything that can be proven without a
real Postgres endpoint has been proven, with real numbers, including real (if local) `EXPLAIN`
output — but "done" for this specific task means live evidence against Neon, and that evidence does
not exist yet.
