# T-12 · LEDGER — Backend API and schema

**Area:** `api/`, `infra/schema.sql` · **Depends on:** T-02 TAPE *(interface only)* · **Blocks:** T-13 PODIUM

## Goal

Server-verified global leaderboards and custom-level storage. Vercel serverless functions plus
managed Postgres — no Hetzner box needed for this scope (DESIGN.md §8).

## Owned files

```
api/**
infra/schema.sql
```

`infra/` otherwise belongs to T-14 LAUNCHPAD; `schema.sql` is the one file you own there.

## Stack

- **Vercel serverless functions**, TypeScript, one file per route.
- **Neon Postgres** (free tier is ample). Use the HTTP driver — serverless functions over a raw
  TCP Postgres connection exhaust the connection pool under any concurrency, and that failure mode
  appears only under load. This is the specific reason not to self-host Postgres on Hetzner today.
- **No ORM.** Four tables' worth of SQL does not need one, and `core` stays dependency-free.

## Schema

```sql
create table score (
  id          bigserial primary key,
  level_id    text        not null,
  player_name text        not null,
  time_ms     integer     not null,
  boost_ms    integer     not null,
  tape        text,
  verified    boolean     not null default false,
  created_at  timestamptz not null default now()
);
create index on score (level_id, time_ms);
create index on score (level_id, boost_ms);

create table custom_level (
  id         text primary key,
  name       text        not null,
  author     text        not null,
  data       jsonb       not null,
  plays      integer     not null default 0,
  created_at timestamptz not null default now()
);
```

## Routes

As specified in [INTERFACES.md](../INTERFACES.md#api--t-12-ledger). The contract there is frozen —
T-13 PODIUM is writing a client against it right now.

## Verification is the point

`POST /api/score` **must** call `verifyReplay` from `@swingby/core` before writing `verified: true`.
This is why `core` has no browser dependencies: the exact code that ran in the player's browser runs
here. Budget is comfortable — a 60-second tape verifies in well under 100 ms.

Rules:

- Verification failure → store with `verified: false` or reject outright; never store as verified.
- Unverified entries **never outrank verified ones**, regardless of value. Sort verified first, then
  by metric.
- Verify before insert, not asynchronously after. There is no queue in this design and adding one
  is not in scope.

## Abuse surface

This is a public write endpoint on a personal domain. Minimum:

- Rate limit by IP — a few submissions per minute is generous for a human.
- Cap `player_name` at 24 chars, strip control characters, escape on output. Names are rendered on
  your site.
- Cap tape payload at 64 KB; T-02's malformed-tape rules reject anything sane long before that.
- Validate custom level bodies through T-03's `validate` before storing. Do not trust `data`.
- Cap `objects.length` and total payload — an adversarial level with 10,000 bodies makes
  verification quadratic and is a cheap DoS.

## Custom level ids

Short, URL-safe, non-sequential slugs (8–10 chars from a base32 alphabet). Sequential ids let anyone
enumerate every level ever shared, which matters because sharing is unlisted-by-default (DESIGN.md
§9).

## Deliverables

| # | Artifact | Path |
|---|---|---|
| 1 | Six routes matching the frozen contract | `api/leaderboard.ts`, `api/score.ts`, `api/levels/*.ts` |
| 2 | Schema, applied to Neon | `infra/schema.sql` |
| 3 | Shared db helper (HTTP driver) and input validation | `api/_db.ts`, `api/_validate.ts` |
| 4 | Rate limiting | `api/_ratelimit.ts` |
| 5 | Integration tests against a scratch database | `api/test/**` |
| 6 | `EXPLAIN` output for both leaderboard queries, in the PR | — |
| 7 | Measured cold start and verification time, in the PR | — |

## Definition of done

- [ ] All routes match the frozen contract in INTERFACES.md exactly
- [ ] A genuine tape from a real playthrough submits and verifies
- [ ] **A tampered tape (one flipped index) is rejected**
- [ ] A claimed time that does not match the replay is rejected
- [ ] Unverified entries never outrank verified ones, at any value
- [ ] Leaderboard queries use the indexes — `EXPLAIN` output pasted in the PR, not asserted
- [ ] Rate limiting demonstrably works (show it triggering)
- [ ] Oversized and malformed payloads rejected **before** any simulation runs
- [ ] Custom level bodies validated through T-03's `validate` before storage
- [ ] Cold start **< 1 s**, verification **< 100 ms** — report both
- [ ] Secrets in environment variables only; `git log -p` shows no connection string ever committed
- [ ] Plus the global checklist in [PROJECT.md §7](../PROJECT.md#7-definition-of-done-globally)

## Working without T-02

`verifyReplay`'s signature is frozen. Stub it as `() => ({ ok: true, ... })`, build every route, and
swap the real implementation in when TAPE lands. Nothing else about the API depends on it.

## How to verify

```bash
npm test -w @swingby/api
vercel dev                     # local functions on :3000
```

**1. Routes match the contract.** Exercise each against the local server:

```bash
curl -s "localhost:3000/api/leaderboard?level=builtin-01&metric=fastest&limit=10" | jq
curl -s -X POST localhost:3000/api/score -H 'content-type: application/json' \
  -d @test/fixtures/valid-score.json | jq
```

**2. Rejection paths — the ones that matter.** Each must be refused:

```bash
curl -s -X POST localhost:3000/api/score -d @test/fixtures/tampered-tape.json     # flipped index
curl -s -X POST localhost:3000/api/score -d @test/fixtures/wrong-claim.json       # time mismatch
curl -s -X POST localhost:3000/api/score -d @test/fixtures/oversized.json         # >64 KB
curl -s -X POST localhost:3000/api/levels -d @test/fixtures/10k-bodies.json       # DoS shape
```

A route that accepts the tampered tape means verification is not wired in — the most likely way this
task ships broken, because everything else still works.

**3. Rate limiting.** Fire 50 submissions in 10 s from one IP; confirm 429s and paste the output.

**4. Index usage** — paste the output, do not assert it:

```sql
EXPLAIN ANALYZE SELECT * FROM score WHERE level_id='builtin-01' ORDER BY time_ms LIMIT 50;
```

Must show an index scan. A sequential scan on an empty table looks fine and will not stay fine.

**5. Timings.** Report cold start (first request after idle) and verification time for a 60 s tape.
Budgets: < 1 s and < 100 ms.

**6. Secrets:** `git log -p -- api/ infra/ | grep -i "postgres://"` must be empty.
