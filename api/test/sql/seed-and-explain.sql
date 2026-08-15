-- T-12 LEDGER — seeds a representative row count into a scratch database, then runs the exact two
-- leaderboard queries `api/_db.ts`'s `leaderboardQuery()` emits, via EXPLAIN ANALYZE.
--
-- Run against a scratch Postgres (this repo has none reachable — see notes/T-12-LEDGER/log.md and
-- results/T-12-LEDGER.md for how a LOCAL Postgres 16 scratch database was used in this container;
-- this file is what produced the EXPLAIN output pasted into results/T-12-LEDGER.md):
--
--   psql -h localhost -U swingby -d swingby_test -f api/test/sql/seed-and-explain.sql
--
-- Deliberately NOT run automatically by `npm test` — this mutates a real database and is meant to
-- be re-run by hand (locally now, or against Neon later once Magnus has provisioned it).

truncate table score;
truncate table custom_level;

-- 40 distinct levels, 300 rows each (12,000 rows total) — comfortably past the row count where
-- Postgres's planner stops trusting a sequential scan is cheaper, and past the point a hand-wavy
-- "looks fine on an empty table" check would catch (see tasks/T-12-LEDGER.md's own warning).
-- ~90% verified, ~10% unverified, matching a plausible real ratio (most submissions that reach this
-- far already passed verifyReplay; a slice of forged/rejected volume is folded in as unverified rows
-- for the invariant check even though the current write path never produces one itself — see
-- notes/T-12-LEDGER/log.md decision 1 on why the column exists regardless).
-- boost_ms is derived FROM time_ms (as a random fraction of it) rather than generated
-- independently, so every synthetic row satisfies the same `boost_ms <= time_ms` check constraint
-- schema.sql enforces for real rows — a plain independent `random()*5000` here produced rows the
-- constraint correctly rejected on first attempt (caught by the constraint doing its job).
insert into score (level_id, player_name, time_ms, boost_ms, verified, created_at)
select level_id, player_name, time_ms, (random() * time_ms * 0.3)::int, verified, created_at
from (
  select
    'builtin-' || lpad((n / 300)::text, 2, '0') as level_id,
    'player' || n as player_name,
    (1000 + (random() * 60000))::int as time_ms,
    (random() < 0.9) as verified,
    now() - (random() * interval '30 days') as created_at
  from generate_series(0, 11999) as n
) sub;

-- A few unverified rows with deliberately tiny (unbeatable-looking) values on one specific level, to
-- make the "never outranks verified" property visible in the EXPLAIN'd query's actual result order,
-- not just in the plan shape.
insert into score (level_id, player_name, time_ms, boost_ms, verified, created_at)
values
  ('builtin-00', 'forger-1', 1, 0, false, now()),
  ('builtin-00', 'forger-2', 2, 0, false, now());

insert into custom_level (id, name, author, data, plays, created_at)
select
  'SEED' || lpad(n::text, 5, '0'),
  'Level ' || n,
  'author' || (n % 50),
  '{"goal":{"index":1,"range":50},"objects":[]}'::jsonb,
  (random() * 500)::int,
  now() - (random() * interval '90 days')
from generate_series(0, 499) as n;

\echo '=== row counts after the moderate (300/level) seed ==='
select 'score' as table_name, count(*) from score
union all
select 'custom_level', count(*) from custom_level;

\echo '=== EXPLAIN ANALYZE at moderate volume (302 rows for builtin-00): metric=fastest ==='
explain analyze
select player_name, time_ms, boost_ms, verified, created_at,
       row_number() over (order by verified desc, time_ms asc) as rank
from score
where level_id = 'builtin-00'
order by verified desc, time_ms asc
limit 50;

\echo '=== EXPLAIN ANALYZE at moderate volume: metric=efficient ==='
explain analyze
select player_name, time_ms, boost_ms, verified, created_at,
       row_number() over (order by verified desc, boost_ms asc) as rank
from score
where level_id = 'builtin-00'
order by verified desc, boost_ms asc
limit 50;

-- A single, long-lived, popular level accumulates far more rows than the moderate seed above ever
-- will. At only ~300 rows/level, Postgres's planner reasonably decides a bitmap scan + in-memory
-- sort is cheaper than an ordered index walk (materializing and quicksort-ing 300 rows costs
-- nothing) — see results/T-12-LEDGER.md for that plan too. This second seed, 200,000 EXTRA rows all
-- on builtin-00 (200,302 total for that one level), is what makes the composite index's real
-- benefit show up in the plan: an ordered Index Scan that can stop after 50 rows without touching
-- the other ~200,000.
insert into score (level_id, player_name, time_ms, boost_ms, verified, created_at)
select level_id, player_name, time_ms, (random() * time_ms * 0.3)::int, verified, created_at
from (
  select
    'builtin-00' as level_id,
    'heavy' || n as player_name,
    (1000 + (random() * 60000))::int as time_ms,
    (random() < 0.9) as verified,
    now() - (random() * interval '365 days') as created_at
  from generate_series(1, 200000) as n
) sub;

\echo '=== row count for builtin-00 after the heavy-load seed ==='
select count(*) from score where level_id = 'builtin-00';

\echo '=== EXPLAIN ANALYZE at 200,302 rows (one level): metric=fastest ==='
explain analyze
select player_name, time_ms, boost_ms, verified, created_at,
       row_number() over (order by verified desc, time_ms asc) as rank
from score
where level_id = 'builtin-00'
order by verified desc, time_ms asc
limit 50;

\echo '=== EXPLAIN ANALYZE at 200,302 rows (one level): metric=efficient ==='
explain analyze
select player_name, time_ms, boost_ms, verified, created_at,
       row_number() over (order by verified desc, boost_ms asc) as rank
from score
where level_id = 'builtin-00'
order by verified desc, boost_ms asc
limit 50;

\echo '=== EXPLAIN ANALYZE: custom_level list, sort=new (api/_db.ts listLevelsQuery("new")) ==='
explain analyze
select id, name, author, plays from custom_level order by created_at desc limit 20;

\echo '=== EXPLAIN ANALYZE: custom_level list, sort=top (api/_db.ts listLevelsQuery("top")) ==='
explain analyze
select id, name, author, plays from custom_level order by plays desc, created_at desc limit 20;

\echo '=== verified-first invariant, visible in real query output (top 5 rows for builtin-00/fastest) ==='
select player_name, time_ms, boost_ms, verified
from score
where level_id = 'builtin-00'
order by verified desc, time_ms asc
limit 5;
