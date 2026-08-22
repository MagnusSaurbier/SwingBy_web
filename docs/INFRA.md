# SwingBy Web — infrastructure and backend

_Read this when your task touches the API, the database, deployment, or hosting. For the
step-by-step deploy procedure and CI/automation status, see [infra/DEPLOY.md](../infra/DEPLOY.md)
and [infra/AUTOMATION.md](../infra/AUTOMATION.md) — this file is the architecture and the reasoning
behind it, not the runbook._

## 1. Backend scope

The game needs **no backend to be played.**

| Feature                                     | Needs backend?      |
| ------------------------------------------- | ------------------- |
| Play the 33 built-in levels                 | No — static         |
| Settings, personal bests, custom levels     | No — `localStorage` |
| Global leaderboards (fastest + least-boost) | Yes                 |
| Custom level sharing                        | Yes                 |

### API surface

```
GET  /api/leaderboard?level=<id>&metric=fastest|efficient&limit=50
     → { entries: [{ rank, name, timeMs, boostMs, verified, createdAt }] }

POST /api/score
     { levelId, metric, timeMs, boostMs, name, tape }
     → { accepted: boolean, verified: boolean, rank?: number, reason?: string }

GET  /api/levels?sort=new|top&limit=20      → { levels: [{ id, name, author, plays }] }
GET  /api/levels/:id                        → { id, name, author, data }
POST /api/levels  { name, author, data }    → { id }
```

`POST /api/score` **must** call `verifyReplay` server-side before writing with `verified: true`.
Unverifiable submissions may be stored with `verified: false` but must never outrank verified ones.

### Schema (Postgres, `infra/schema.sql`)

```sql
create table score (
  id          bigserial primary key,
  level_id    text        not null,
  player_name text        not null,
  time_ms     integer     not null,
  boost_ms    integer     not null,
  replay      bytea,
  verified    boolean     not null default false,
  created_at  timestamptz not null default now()
);
create index on score (level_id, time_ms);
create index on score (level_id, boost_ms);

create table custom_level (
  id         text primary key,          -- short slug for share URLs
  name       text        not null,
  author     text        not null,
  data       jsonb       not null,
  plays      integer     not null default 0,
  created_at timestamptz not null default now()
);
```

## 2. Determinism and score verification

The simulation is deterministic: fixed tick rate, no randomness in the physics path. Given
identical initial conditions and identical per-tick input, the trajectory is reproducible. So a
score is submitted as an **input tape** and replayed server-side.

**Tape encoding.** Boost and brake are booleans sampled per tick. At 144 Hz a 60-second run is
8,640 ticks, but a human produces on the order of tens of state changes, so the tape stores
transition tick indices, not per-tick samples:

```
{ boost: [412, 470, 1203, 1250, ...], brake: [3100, 3180, ...], ticks: 8640 }
```

A typical run is a few hundred bytes. Verification re-runs `core/physics.ts` in Node, confirms
goal capture, and compares elapsed and boost time against the claim. Worst case is well under
100 ms, comfortably inside a serverless invocation.

This is also why the physics path avoids `Math.pow` (see [docs/GAME.md](GAME.md) §4): client and
server must agree bit-for-bit, and only `+ - * / sqrt` are guaranteed correctly-rounded across
engines.

## 3. Hosting — `swingby.magnussaurbier.de`

Own subdomain, not a path on the personal site. The personal site is a static build on Vercel,
auto-deploying from its own repo on push to `main`. SwingBy has its own repo, its own Vercel
project, and its own domain — **the personal site repo is never modified**, except for a single
reviewed link to the game.

- **DNS is on Cloudflare.** `swingby` is a `CNAME` to `cname.vercel-dns.com`, set to **DNS only
  (grey cloud)**, never proxied — see `infra/DEPLOY.md` §3 for why this is the step that reliably
  goes wrong.
- **Same-origin API.** The API is served from `swingby.magnussaurbier.de/api`, so there is no CORS
  configuration and no preflight on score submission.
- **Separate storage origin.** `localStorage` on the subdomain is distinct from the apex — a
  player's data is tied to the subdomain, so treat the hostname as permanent once anyone has saved
  a score.

## 4. Vercel, not a self-hosted box

Vercel covers this entire scope: static bundle + CDN, serverless functions for the API, and
Postgres via Neon (free tier, HTTP-driver-compatible connection string — see `infra/DEPLOY.md` §5
for why the pooled/HTTP string specifically, not a raw TCP one).

A self-hosted box would only be worth it if realtime multiplayer (persistent WebSockets, which
serverless functions cannot hold) becomes a real requirement. Nothing in the current scope needs
it.

## 5. Open, ongoing concerns

- **UGC moderation.** Public custom-level sharing puts user-submitted names and author strings on
  the personal domain. Unlisted share links (`/l/<slug>`) first; a public browse list only if it
  gets used. Cheap insurance: length caps, HTML escaping, a profanity filter on names.
- **Mobile controls.** Touch model is boost zone / brake zone. A physics puzzler that is
  unplayable on phones loses most of the traffic a personal site sends it — keep testing on real
  devices, not just emulation.
- **Audio.** All sound is synthesized procedurally at runtime (WebAudio oscillators) — no audio
  files ship, so there is no licensing question to track.
