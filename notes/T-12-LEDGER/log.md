# T-12 LEDGER — working log

## 2026-08-15T00:00Z — Read-through complete, environment probed, plan before writing code

Read in order: README.md, PROJECT.md, INTERFACES.md (full), tasks/T-12-LEDGER.md, DESIGN.md §5/§6/§7/§8,
notes/T-02-TAPE/log.md, notes/README.md. Also read packages/core/src/{types.ts,constants.ts,level.ts,replay.ts}
in full (not just signatures) since verifyReplay's exact semantics and validate()'s exact rules are
load-bearing for the routes. Confirmed `@swingby/core`'s package.json exports `.` -> `src/index.ts`,
which already re-exports replay.ts (T-02 landed for real, not stubbed) — no adapter needed.

**Environment facts that change the plan (per the task briefing, confirmed independently):**

- `which psql pg_ctlcluster docker` all resolve. `pg_lsclusters` showed a real Postgres 16 cluster,
  `down`. `pg_ctlcluster 16 main start` brought it up — genuinely available, root in this container.
  Docker daemon is NOT running (`docker info` fails to reach the socket) and I will not try to start
  it (out of scope, risky, unnecessary now that native Postgres works).
- Created a scratch DB/role: `CREATE DATABASE swingby_test; CREATE USER swingby ...; GRANT ...`.
  Will apply `infra/schema.sql` here via `psql` directly and capture real `EXPLAIN ANALYZE` output
  after seeding representative row counts (task doc's own warning: an empty-table plan is misleading).
- **Important nuance, not to lose:** `@neondatabase/serverless`'s `neon()` HTTP driver (what
  `api/_db.ts` must use in production, per task doc and `api/package.json`'s own comment) speaks
  Neon's SQL-over-HTTP protocol, which vanilla local Postgres does not expose. There is no
  Neon-compatible local HTTP gateway available here (would need `neon-local`'s Docker image, and
  dockerd isn't running). So: local Postgres is genuine, strong evidence for **schema correctness,
  index usage, and EXPLAIN output** (deliverables 2 and 6) via raw `psql`, but I still cannot exercise
  the real `@neondatabase/serverless` code path end-to-end. Decision: `api/_db.ts`'s data-access
  functions take an injected `QueryFn` (`(text, params) => Promise<Row[]>`) — the exact shape
  `neon(url)` itself satisfies when called in "ordinary function" mode (confirmed in
  `node_modules/@neondatabase/serverless/index.d.ts`: `sql(text, params)` returns rows directly,
  `$1`/`$2` placeholders, no tagged-template requirement). Production wires the real `neon()` call;
  `api/test/**` wires a thin in-memory fake of the *same* `QueryFn` shape. This keeps the seam small
  and honest — the fake isn't asserting my route logic back at itself, it's a generic little
  filter/sort/limit-over-arrays engine that answers the same parameterized queries a real Postgres
  would, independently written.

**Design decisions locked in before writing code:**

1. **Verification-failure policy: reject outright, do not store `verified: false` rows via the normal
   submit path.** Task doc explicitly allows either ("store with verified: false or reject outright;
   never store as verified") and the DoD checklist phrases every failure case as "is rejected". Chose
   reject-outright because (a) it matches the DoD wording literally, (b) it avoids DB bloat from junk
   submissions, (c) the *reason* the interface still documents "unverified must never outrank
   verified" is defense-in-depth for the schema/query layer itself (future bulk-import of
   `DataManager.gd`'s legacy local scores.json is explicitly the kind of write DESIGN.md §5
   anticipates, and it would land as `verified=false` without going through this route at all). I
   still fully implement and test the DB-level invariant (indexes, ORDER BY, rank query) so it's
   correct and proven even though today's only writer never produces a false row. Recorded as an
   ASSUMPTION for review.

2. **Rounding-mismatch risk flagged by T-02's own log is real and has a real fix already in the
   signature**: `verifyReplay`'s `tolerance` parameter exists for exactly "client rounds/floors
   `timeMs` differently than the server's `Math.round(ticks * 1000/144)`". One tick is ~6.94 ms.
   Passing `{ timeMs: 8, boostMs: 8 }` absorbs a one-tick rounding-convention mismatch in either
   direction without materially weakening anti-cheat precision (a forger gaining <1 tick is not a
   meaningful exploit). This directly replaces any temptation to use "store unverified" as a
   workaround for that specific risk.

3. **Rate limiting is in-memory, per-warm-instance, sliding window.** No Redis/KV available and
   `api/package.json` is T-14's file (I can only *request* a dependency, not add one). Documenting
   plainly in results.md: this does NOT coordinate across concurrently-warm Vercel instances, so a
   distributed source (many source IPs, or enough concurrent cold starts) multiplies the effective
   budget by however many instances are warm. This is the honest failure mode, stated as the task
   demands, not hidden. A DB- or KV-backed limiter would fix it and is named as a follow-up.

4. **Schema indexes diverge from the task doc's literal illustrative SQL, deliberately.** The literal
   `create index on score (level_id, time_ms)` does not serve the *actual* required query
   (`ORDER BY verified DESC, time_ms ASC` — verified-first is not optional, INTERFACES.md says
   "never outrank"). Indexing `(level_id, verified desc, time_ms)` / `(level_id, verified desc,
   boost_ms)` instead lets Postgres satisfy the real leaderboard query with a single index scan, no
   extra Sort node. Will show this in the real EXPLAIN output. `schema.sql` is my file to design, not
   a frozen interface (only the six *routes'* request/response shapes in INTERFACES.md are frozen),
   so this is in scope.

5. **POST /api/levels `data` field ambiguity, resolved.** INTERFACES.md (frozen, authoritative) says
   `POST /api/levels { name, author, data }`; DESIGN.md's older draft shows a flatter
   `{name, author, objects, goal}` and is explicitly superseded. `Level` itself already carries
   `name`/`author` inside it, so there's a real question of which name/author wins when `data` also
   contains those. Decision: the *outer* `name`/`author` (sanitized, length-capped, stored in
   `custom_level`'s own columns for listing) are canonical; the stored `data` jsonb is reconstructed
   as `{ name: <outer, sanitized>, author: <outer, sanitized>, goal: data.goal, objects: data.objects
   }` before validation/storage, so a client's embedded `data.name` can never silently diverge from
   what the row's own `name` column (and future leaderboard UI) shows. `validate()` from T-03 runs on
   this reconstructed object before anything is written; storage never trusts `data.name`/`data.author`.

6. **Body-size bounding happens on the raw byte stream, before `JSON.parse`, not just on the parsed
   object.** Vercel's default body parser would already have consumed the request by the time a
   handler sees `req.body`, and its default cap (~4.5 MB) is far above what this API needs (64 KB tape
   cap from the task doc). Opting out via `export const config = { api: { bodyParser: false } }` and
   reading the stream myself with an explicit byte ceiling (checking `Content-Length` first for a
   free early rejection, then aborting the stream read itself if actual bytes exceed the cap even when
   `Content-Length` is absent or lying) is what actually satisfies "reject early... before any
   simulation runs" for payload *size* specifically, as opposed to payload *shape* (which
   `verifyReplay`'s own `findMalformedReason` already bounds cheaply, and which I also re-check
   independently in `_validate.ts` for defense-in-depth / specific 400 reasons, not because I distrust
   T-02's guarantees).

7. **Custom level ids**: NOT T-03's `customLevelId()` (that one is content-derived, for local storage,
   and explicitly documented as unsuitable as a durable DB primary key — INTERFACES.md says so
   directly: "T-12 LEDGER mints its own independent slug for shared levels precisely for this
   reason"). Minting an 9-char random slug from a 32-symbol alphabet (ambiguous chars 0/O/1/I/L
   excluded, matches task doc "8-10 chars from a base32 alphabet") via `crypto.getRandomValues`
   (global in Node 22, zero new dependency). Insert-and-retry-on-conflict, generator function
   injectable so a collision can be deterministically forced in a test rather than only reasoned about
   probabilistically (32^9 ≈ 3.5e13, collision is not going to happen for real at this scale, but the
   retry path should still be exercised by a real test, not just trusted).

**Plan / file-by-file:**

- `api/_validate.ts` — size/shape constants, `readJsonBody` (raw-stream cap), `sanitizeName`,
  metric/sort allowlists, `parseLimit`, level-id shape guard, level-payload guards.
- `api/_db.ts` — `QueryFn` type, `getSql()` (lazy env-based `neon()`), camelCase-mapping data-access
  functions for both tables, rank computation, slug minting + retry.
- `api/_ratelimit.ts` — in-memory sliding-window limiter factory, IP extraction, two configured
  instances (score, levels).
- `api/score.ts`, `api/leaderboard.ts`, `api/levels/index.ts`, `api/levels/[id].ts` — thin Vercel
  adapter (`export default`) wrapping an exported, directly-testable core function per route.
- `infra/schema.sql` — as above.
- `api/test/**` — in-memory `QueryFn` fake (generic, not per-route), route-logic tests, hostile-input
  table cases, forgery accept/reject counts against the real 33 solving tapes, rate-limit trigger
  proof, fail-proof demonstration (temporarily neuter the `verifyReplay` call).
- Apply `infra/schema.sql` to the local scratch Postgres, seed, capture real `EXPLAIN ANALYZE`.
- `results/T-12-LEDGER.md` with every number, the hostile-input table, and a clearly headed BLOCKED
  section (Neon provisioning/apply/EXPLAIN-on-real-Neon/cold-start — none of which this container can
  do; local Postgres closes the schema-correctness gap but not the "real Neon HTTP driver, real
  Vercel cold start" gap).

**Next step:** write `api/_validate.ts` first (no dependencies on the others), then `_ratelimit.ts`,
then `_db.ts`, then the four route files, then apply schema to local Postgres (slow/risky — will log
again right before and right after), then tests, then measurements, then results.md.

## 2026-08-15T10:47Z — Resumed after a usage-limit interruption; three real bugs found and fixed

Session was killed mid-implementation (last state: all source files + all test files written,
typecheck/lint/full-suite never yet run to green). Resumed with capacity restored; all files
survived on disk. The orchestrator had already run the suite once and reported 2 typecheck errors
and 7 test failures — used that as the starting checklist rather than re-discovering it blind.
Local Postgres 16 cluster (`swingby_test` scratch DB, `swingby` role) from the earlier session also
survived (`pg_lsclusters` still showed it, just needed `pg_ctlcluster 16 main start` again).

**Bug 1 — typecheck: `ClientIpSource` triggered TS's "weak type" rule.** `getClientIp(req:
ClientIpSource)` failed to accept a real `VercelRequest` with "Type 'IncomingHttpHeaders' has no
properties in common with type '{ "x-forwarded-for"?: ... }'". Root cause: `x-forwarded-for` is not
one of Node's individually-typed `IncomingHttpHeaders` fields (only "well-known" headers like
`content-length` get that treatment — checked `@types/node/http.d.ts` directly), so it only exists
via the inherited `NodeJS.Dict<string|string[]>` index signature. A target type whose ONLY property
is both optional and not a *named* match trips TS's weak-type check. Fix: changed
`ClientIpSource.headers` from a single named optional property to an index signature
(`{ [header: string]: string | string[] | undefined }`), which is what `IncomingHttpHeaders` itself
structurally provides. `JsonBodySource` (the analogous type for `readJsonBody`) never hit this
because `content-length` genuinely IS individually named in `IncomingHttpHeaders` — only
`x-forwarded-for` was exposed. Lesson for later: prefer index-signature shapes over
single-named-optional-property shapes whenever the narrowed interface is meant to structurally
accept a real Node header-bag type.

**Bug 2 — `readJsonBody` test hang (NOT a production bug, confirmed by isolation).** 4 tests in
`_validate.test.ts` timed out at ~5000ms each. Root-caused with an isolated two-test repro file: a
`for await (const chunk of req)` over an unmodified `Readable.from([...])` resolves instantly; the
IDENTICAL loop over the same stream with its `.destroy` method overridden by a hand-written wrapper
(the original `fakeRequest` test helper, added to track a `destroyed` flag) hangs forever, every
time, even on the path that never calls `.destroy()` at all. Conclusion: Node's internal
`Readable`-async-iterator cleanup machinery depends on `stream.destroy()` behaving exactly like
`Readable.prototype.destroy` (almost certainly return-value chaining — the prototype method returns
`this` for chaining; my override returned `undefined`, and something downstream likely called a
method on that `undefined` inside a code path whose rejection never propagates to the awaited
promise). Fix: stopped shadowing `destroy` entirely — `Readable` already has a real native
`.destroyed` getter and `.destroy()`, so the wrapper was solving a problem Node already solves.
**This was purely a test-double artifact.** `readJsonBody` itself was never wrong: the isolated
repro's "no override" variant passed instantly, and once the fix landed all `readJsonBody` tests
(including the ones that genuinely trigger `req.destroy()` on the oversized-body path) pass in low
single-digit milliseconds. Recording this explicitly because the orchestrator's message specifically
asked to say plainly if the hang were real — it is not; production `IncomingMessage.destroy` is
never monkey-patched by anything in this codebase.

**Bug 3 — `insertCustomLevel`'s retry loop couldn't ever reach its own `LevelIdExhaustedError`.**
The catch block was `if (isUniqueViolation(err) && attempt < MAX_ID_ATTEMPTS - 1) continue; throw
err;` — on the LAST allowed attempt, the condition is false, so it falls through to `throw err`,
re-raising the raw `{code: "23505"}` collision error instead of the intended
`LevelIdExhaustedError`. The `throw new LevelIdExhaustedError()` after the loop was dead code (every
iteration always either returns or throws). Fix: split into `if (!isUniqueViolation(err)) throw
err;` (real failures never retried) then `if (attempt === MAX_ID_ATTEMPTS - 1) throw new
LevelIdExhaustedError();` (only a genuine collision on the final attempt maps to the intended
exhaustion error). Caught by the test that FORCES a collision via an injected `idGenerator` — exactly
the kind of thing that "reasoning about the odds" (32^9 possible ids) would never have caught.

**Design correction — `flipOneTransition`'s original ±1-tick nudge was too weak, and my first test
assertion for it was WRONG, not just the implementation.** First cut of the "tampered tape (one
flipped index)" corpus test asserted `unexpectedlyAccepted === 0` across all 33 real tapes. Got 7
unexpectedly-accepted. Investigated rather than just patching the assertion: a ±1-tick (1/144s ≈
6.9ms) nudge to a control's transition tick is sometimes fully absorbed by the physics with ZERO
effect on which tick the goal is actually captured on — and if the tamper doesn't change the real
outcome, accepting it is CORRECT, not a bug (the claim still matches what actually happened; there is
nothing to detect). So my original assertion encoded the wrong invariant. Fixed two ways:
1. Strengthened `flipOneTransition` to prefer a ±25-tick (~0.17s) nudge, falling back to ±1 only if
   that doesn't fit in bounds — more likely to actually perturb the outcome, for a more informative
   test.
2. Rewrote the test to check the REAL invariant: independently re-probe the tampered tape's true
   outcome via `verifyReplay` itself (not trusting `handleScore`'s verdict), and assert `0` cases
   where the outcome genuinely changed AND were still accepted — that is the actual forgery-bypass
   check. Cases where the outcome didn't change are bucketed separately as legitimately-accepted, not
   asserted to be zero.

Also discovered while investigating: **11 of the 33 real solving tapes have BOTH `boost: []` and
`brake: []`** — they solve by pure coasting, zero input, launched with exactly the right initial
velocity. `flipOneTransition` correctly returns `null` for these (nothing to flip) — confirmed by
direct inspection of all 33 tape files, not inferred. Added a SECOND, independent tamper class,
`truncateTape` (reuses T-02's own proven method from notes/T-02-TAPE/log.md: shave the last tick off
a tight tape, since `ticks = reachedTick + 1` for every one of these 33 by construction — T-02
reported 33/33 broken with this exact method), specifically to cover those 11. Result: **flip-tamper
corpus: 22 flippable / 22 rejected / 0 accepted-with-changed-outcome. truncate-tamper corpus: 33/33
rejected.** Between the two tamper classes, every one of the 33 real tapes has at least one proven
forgery-rejection data point.

**Fixed the SQL-metacharacter-in-`name` test too** — it asserted the FULL 30-character injection
string round-tripped unmangled, but `sanitizeName` correctly caps at `MAX_NAME_LEN` (24), so the test
itself was wrong (asserting behavior that contradicts the task doc's own "cap player_name at 24
chars" requirement). Fixed by using a 24-char injection payload (`"R'); DROP TABLE
score;--"` — exactly 24 chars, verified with `.length` in the test itself) so length truncation and
metacharacter-survival are tested as separate, non-confounded properties.

**Formatting**: initial `npm run lint` pass appeared to show only 4 of my files needing
`prettier --write` — that was an artifact of piping through `tail -80` on a ~96-file repo-wide
warning list (alphabetically, most of `api/**` sorted above the tail window). Re-ran without
truncating and found the real list (all of `api/**` except a few already-clean files); ran
`prettier --write "api/**/*.{ts,json}"` once, confirmed `npm run lint` no longer reports ANY `api/`
path (repo-wide failures remaining are entirely other tasks' files, not touched). `infra/schema.sql`
is never touched by `prettier --check .` at all — confirmed directly: prettier has no built-in SQL
parser, and passing it an explicit path errors ("No parser could be inferred"), but running the
directory-glob form (what `npm run lint` actually does) silently skips extensions it doesn't
recognize rather than erroring. Not a problem, just worth recording so a future run isn't surprised.

**State: typecheck clean (api/** only, confirmed with an injected error that WAS caught, so this
isn't a false negative from a stale build cache), lint clean for every api/** file, 111/111 tests
green across 7 files** (`_validate`, `_ratelimit`, `_db`, `score`, `leaderboard`, `levels`,
`fixtures`). Repo-wide `npx vitest run` (no path filter): 596 passed, 1 skipped (T-01's known Godot
parity gate), 29 files — confirms nothing here broke any other task's suite.

**Next step:** apply `infra/schema.sql` to the local scratch Postgres for real, seed representative
row counts, capture real `EXPLAIN ANALYZE` for both leaderboard metrics (this is the risky/slow step
— logging immediately before it as the cadence rule requires). Then measure `verifyReplay` timing
through the real route path, do the fail-proof demonstration (neuter the `verifyReplay` call, show
red, revert), then write results/T-12-LEDGER.md.
