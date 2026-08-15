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
