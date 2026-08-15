-- T-12 LEDGER — database schema.
--
-- Owned by T-12 LEDGER. This is the one file under infra/ this task may touch (INTERFACES.md file
-- ownership table; everything else under infra/ belongs to T-14 LAUNCHPAD).
--
-- Every statement is idempotent (IF NOT EXISTS / OR REPLACE) so this file can be re-applied against
-- the same database without erroring — safe to paste into the Neon SQL editor more than once.
--
-- Applied and exercised against a local, throwaway Postgres 16 scratch database in this container
-- (no Neon account / no DATABASE_URL / no network reachable Postgres — see
-- notes/T-12-LEDGER/log.md and results/T-12-LEDGER.md). It has NEVER been applied to Neon itself;
-- that is explicitly called out as BLOCKED in results/T-12-LEDGER.md.

create table if not exists score (
  id          bigserial   primary key,
  level_id    text        not null check (char_length(level_id) between 1 and 40),
  player_name text        not null check (char_length(player_name) between 1 and 24),
  time_ms     integer     not null check (time_ms >= 0),
  boost_ms    integer     not null check (boost_ms >= 0 and boost_ms <= time_ms),
  -- `JSON.stringify`'d ReplayTape for verified rows (api/_db.ts `insertScore`). Nullable: the
  -- current write path (api/score.ts) only ever inserts verified rows with a tape attached and
  -- rejects everything else outright (see notes/T-12-LEDGER/log.md decision 1), but the column
  -- stays nullable for forward-compatibility with e.g. a future bulk import of legacy local scores
  -- (DESIGN.md §5 notes `DataManager.gd`'s `user://scores.json` as a real prior format).
  tape        text,
  verified    boolean     not null default false,
  created_at  timestamptz not null default now()
);

-- Leaderboard ordering is ALWAYS "verified first, then metric ascending" — never metric alone.
-- INTERFACES.md is explicit: unverified entries must never outrank verified ones, "regardless of
-- value". A plain `(level_id, time_ms)` index — the task doc's own illustrative SQL — cannot serve
-- `ORDER BY verified DESC, time_ms ASC` without an extra sort step once the row count grows past
-- what fits in a quick sort. Indexing `(level_id, verified DESC, metric)` instead lets Postgres
-- satisfy the real query with a single index scan and no separate Sort node. See
-- results/T-12-LEDGER.md for the actual `EXPLAIN ANALYZE` output (from the local scratch database)
-- proving this.
create index if not exists score_level_verified_time_idx
  on score (level_id, verified desc, time_ms);
create index if not exists score_level_verified_boost_idx
  on score (level_id, verified desc, boost_ms);

create table if not exists custom_level (
  id         text        primary key,
  name       text        not null check (char_length(name) between 1 and 48),
  author     text        not null check (char_length(author) between 1 and 32),
  data       jsonb       not null,
  plays      integer     not null default 0 check (plays >= 0),
  created_at timestamptz not null default now()
);

-- Serves GET /api/levels?sort=new and ?sort=top respectively (api/_db.ts `listLevelsQuery`).
create index if not exists custom_level_created_at_idx on custom_level (created_at desc);
create index if not exists custom_level_plays_idx on custom_level (plays desc, created_at desc);
