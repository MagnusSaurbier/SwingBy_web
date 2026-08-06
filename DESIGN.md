# SwingBy Web — Design & Infrastructure Scope

*Draft, 2026-08-05. Status: pre-implementation. Decisions marked **OPEN** need your input.*

---

## 1. Summary

Port SwingBy to the browser and host it at `swingby.magnussaurbier.de`.

**Recommendation:** rewrite the game in TypeScript on Canvas 2D, using `SwingBy2026` (Godot) as the
functional and numerical reference. Ship the game as a static bundle on Vercel. Add a small
serverless API plus a managed Postgres for global leaderboards and custom-level sharing.

**Vercel is sufficient.** The Hetzner box is not needed for anything in this scope. Section 8 states
precisely which future features would change that.

---

## 2. What actually exists today

Three separate codebases, which is the first thing to settle.

| Project | Stack | Last commit | Levels | State |
|---|---|---|---|---|
| `SwingBy2022` | Python / Pygame | 2022-03-17 | — | Original prototype. Historical only. |
| `SwingBy2026` | **Godot 4.6** | 2026-04-12 | **33** | Mature. Editor, workshop, tutorial, settings, audio. ~5,600 lines across 11 modules. |
| `SwingBy` | Swift / SpriteKit | 2026-04-26 | **5** | Clean-architecture rewrite. Physics, editor, HUD. Not near parity. |

The Obsidian notes (`SwingBy_Functional_Description.md`, the ToDo lists, `restructuring-plan.md`)
describe **`SwingBy2026`**, not the Swift project — the restructuring plan maps exactly onto the
Godot module layout that exists today. The functional description's "33 levels", workshop with four
boost variants, username, and rebindable controls are all Godot features. None of them exist in the
Swift project.

So: the notes are not stale about the *Godot* project. They are simply about a different codebase
than the one you pointed me at first.

> **OPEN — 2.1:** `SwingBy2026` is treated below as canonical. That makes the Swift project either
> (a) the native iOS/macOS track, developed in parallel, or (b) abandoned. This affects nothing in
> the web scope, but it decides whether the physics core below needs to be shared with Swift later.

### 2.1 The two physics models differ materially

This is not a detail — it decides whether existing best times survive the port.

| | `SwingBy2026` (Godot) | `SwingBy` (Swift) |
|---|---|---|
| Tick rate | 144 Hz | 120 Hz |
| Substeps | **Adaptive**, 4–12, from local accel + speed | Fixed, max 8, accumulator |
| Softening | Per-pair, derived from body radii | Global constant, `15.0` |
| Falloff | `gravity * d / pow(d²+s², 1.5)` | `G * m / (d²+s²)` |
| Bounds | Rectangle, `2600 × 1800` | Circle, per-level radius |
| Boost | `0.005` along heading | `80.0` along heading |
| Side thrust | Bound to WASD, **force is 0.0** | Not present |

These produce different trajectories from the same level file. Whichever you pick, times recorded
under the other are not comparable, and the 33 built-in levels are only *known solvable* under the
Godot model.

> **OPEN — 2.2:** Port the Godot model. It is the one the 33 levels were designed and verified
> against. Confirm — the alternative is re-verifying every level.

Note `SIDE_THRUST := 0.0`: the WASD bindings exist and do nothing, which the functional description
also records. Either wire them up or drop the bindings in the web version; shipping dead keys to new
players is worse on web than in a desktop build they already know.

---

## 3. The core fork: WASM export vs. rewrite

### Option A — Godot Web export

Godot 4.6 exports to WASM. No `export_presets.cfg` exists yet, so this is unconfigured, but it is a
day of work, not a month.

- **Cost:** ~25–40 MB initial download. Multi-second cold load on desktop, worse on mobile.
- Threaded builds need `SharedArrayBuffer`, which needs COOP/COEP cross-origin isolation headers.
  Vercel can set these, but isolation breaks embedded third-party content on the same document.
  A single-threaded export avoids this at a performance cost.
- Godot 4 web on mobile Safari is unreliable — memory pressure and audio-context quirks.
- The canvas is opaque to the page: no deep links, no SEO, no HTML UI, no sharing preview.

Right choice if the goal is "playable on the web this week."

### Option B — TypeScript rewrite (recommended)

The line counts make this far less daunting than it looks:

| Godot module | Lines | Web equivalent |
|---|---:|---|
| `UIBuilder.gd` | 2,168 | **HTML + CSS.** Most of this disappears — it is imperative construction of widgets a browser gives you declaratively. |
| `GameWorld.gd` | 969 | Canvas renderer + game loop, ~400 lines |
| `LevelEditor.gd` | 733 | Editor, ~600 lines |
| `HUDController.gd` | 309 | React/Svelte component tree, ~150 lines |
| `AudioManager.gd` | 309 | WebAudio, ~150 lines |
| `SceneController.gd` | 294 | Router, ~100 lines |
| `PhysicsEngine.gd` | **224** | **Direct port, ~220 lines.** Pure math, no engine calls. |
| `Main.gd`, `DataManager.gd`, `InputHandler.gd`, `GameConstants.gd` | 584 | ~300 lines |

The single largest file is UI construction, which is exactly the part a web stack makes cheaper. The
part that is hard to get right — the physics — is 224 dependency-free lines of arithmetic.

`data/levels_builtin.json` ports **as-is**. All 33 levels are already plain JSON with the shape
`{name, author, goal: {index, range}, objects: [...]}`. No conversion needed.

- **Cost:** ~150–250 KB gzipped. Instant load. Works on mobile. Real URLs, real HTML UI.
- Enables server-side replay verification (§6), which the WASM path cannot do without a second
  implementation anyway.
- **Effort:** roughly 3–5 focused weeks part-time, front-loaded on physics parity.

> **DECIDED — 3.1 (2026-08-05): Option B, the TypeScript rewrite.** No WASM stopgap.

---

## 4. Frontend architecture (assuming Option B)

```
SwingBy_web/
  packages/
    core/                 # zero-dependency, runs in browser AND node
      physics.ts          # port of PhysicsEngine.gd
      constants.ts        # port of GameConstants.gd
      level.ts            # LevelData types + validation
      replay.ts           # input-tape encode/decode/verify
      levels.json         # copied from SwingBy2026/data/
    web/
      src/
        render/           # canvas: bodies, trail, prediction, force vector, starfield
        game/             # loop, camera, input, audio
        editor/           # port of LevelEditor.gd
        ui/               # menu, level select, settings, HUD, workshop
      public/             # rocket sprites, icons, sfx
  api/                    # Vercel serverless functions
  README.md
  DESIGN.md
```

`packages/core` is the important boundary: it is the *same code* the browser runs and the server
replays. No second implementation, no drift between what the player experienced and what the server
validates.

**Rendering.** Canvas 2D is enough. The Godot renderer draws circles, lines, a starfield, and a
handful of sprites — nothing that needs WebGL. Keep a `Renderer` interface so WebGL is a later swap
if the trail (`TRAIL_LENGTH = 5000`) or prediction (`PREDICTION_TICKS = 1000`) becomes a bottleneck.

**Framework.** Svelte or vanilla + a small router. React is defensible but heavier than this needs.
The game canvas is imperative regardless; the framework only serves menus and HUD.

**Audio.** WebAudio. The Swift rewrite generates all sound procedurally (`AVAudioSourceNode`, sine
synthesis) while Godot ships `.wav` files. Procedural is worth copying — see §9.

**Input.** Keyboard from `DEFAULT_CONTROLS`, plus the existing touch model (boost zone / brake zone).
Gamepad via the Gamepad API is nearly free; the Swift version already has the abstraction.

---

## 5. Backend scope

The game needs **no backend to be played.** Everything below is additive.

| Feature | Needs backend? | Priority |
|---|---|---|
| Play 33 built-in levels | No — static | P0 |
| Settings, personal bests, custom levels | No — `localStorage` / IndexedDB | P0 |
| **Global leaderboards** (fastest + least-boost) | Yes | P1 |
| **Custom level sharing** | Yes | P1 |
| Replay playback / ghosts | Yes (blob storage) | P2 |
| Accounts | Optional | P2 |
| Realtime races | Yes, persistent connections | P3 — not scoped |

`DataManager.gd` already stores scores as `{fastest: {key: {time, name}}, efficient: {...}}` keyed by
level, with a `username` from settings. That is a leaderboard schema already — it just writes to
`user://scores.json` instead of a database.

### API surface

```
GET  /api/leaderboard?level=<id>&metric=fastest|efficient&limit=50
POST /api/score            { levelId, metric, timeMs, boostMs, name, replay }
GET  /api/levels?sort=new|top&limit=20
GET  /api/levels/:id
POST /api/levels           { name, author, objects, goal }
```

### Schema (Postgres)

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

---

## 6. Determinism and score verification

This is the part worth getting right, and it is the strongest argument for Option B.

The simulation is deterministic: fixed tick rate, adaptive substep count derived only from body
state, no randomness in the physics path. Given identical initial conditions and identical per-tick
input, the trajectory is reproducible. So a score can be submitted as an **input tape** and replayed
server-side.

**Tape encoding.** Boost and brake are booleans sampled per tick. At 144 Hz a 60-second run is 8,640
ticks, but a human produces on the order of tens of state changes. Store transition tick indices, not
per-tick samples:

```
{ boost: [412, 470, 1203, 1250, ...], brake: [3100, 3180, ...], ticks: 8640 }
```

A typical run is a few hundred bytes. Verification re-runs `core/physics.ts` in Node, confirms goal
capture, and compares elapsed and boost time against the claim. Worst case — 60 s × 144 Hz × 12
substeps × ~6 bodies — is well under 100 ms, comfortably inside a serverless invocation.

**One concrete numerical fix.** `PhysicsEngine.gd` computes falloff as `pow(softened_dist_sq, 1.5)`.
`Math.pow` is *not* required to be correctly rounded by IEEE 754, and implementations differ across
engines and versions — so client and server could diverge in the last bits, and over 100k substeps
that compounds into a visibly different trajectory. Since `x^1.5 = x·√x`, and both multiplication and
`sqrt` *are* correctly rounded:

```ts
const s = softenedDistSq * Math.sqrt(softenedDistSq);   // not Math.pow(x, 1.5)
```

Do the same in the Godot source if the two are meant to agree. With this change the rest of the
physics path uses only `+ - * / sqrt`, all correctly rounded, so client and server agree bit-for-bit.

**Scope check.** For a hobby leaderboard this is optional — a `verified` flag and rejecting
impossible times gets most of the value. But it is cheap here, and it is a nice thing to have built.

---

## 7. Hosting — `swingby.magnussaurbier.de`

**DECIDED (2026-08-05): own subdomain, not a path.**

The personal site is a static `index.html` on **Vercel**, auto-deploying from
`github.com/MagnusSaurbier/magnussaurbier` on push to `main` (confirmed: `vercel[bot]` production
deployment, project `magnus-saurbier/magnussaurbier`).

SwingBy gets its own repo, its own Vercel project, and its own domain. **The personal site repo is
not modified at all** — no `vercel.json`, no rewrite, no build step added to a page that currently
has none. That is the main practical win over the path-based alternative: the CV page and the game
share a brand, not a deployment.

### Verified DNS facts

| Fact | Value |
|---|---|
| Nameservers | `wally.ns.cloudflare.com`, `neil.ns.cloudflare.com` — **DNS is on Cloudflare** |
| Apex `magnussaurbier.de` | `64.29.17.65`, `216.198.79.65` — Vercel anycast |
| `swingby.magnussaurbier.de` | does not resolve — not yet configured |

### Setup

1. Add `swingby.magnussaurbier.de` as a domain on the SwingBy Vercel project.
2. In Cloudflare DNS, add `CNAME swingby → cname.vercel-dns.com`.
3. **Set that record to "DNS only" (grey cloud), not proxied (orange cloud).** Proxying Cloudflare in
   front of Vercel double-CDNs the site and breaks Vercel's automatic certificate issuance, which
   fails as a TLS error rather than anything that names the cause. This is the one step that
   reliably goes wrong.

### Consequences

- **Same-origin API.** The API is served from `swingby.magnussaurbier.de/api`, so there is no CORS
  configuration and no preflight on score submission.
- **Separate storage origin.** `localStorage` on the subdomain is distinct from the apex. Nothing is
  shared today, so this costs nothing — but it does mean a player's data is tied to the subdomain,
  so the hostname should be treated as permanent once anyone has saved a score.
- **Link from the site.** The apex should link to the game; it is the only remaining connection
  between them, and it is a one-line change to `index.html` rather than a routing rule.

---

## 8. Vercel vs. Hetzner

**Vercel covers this entire scope.**

| Need | Vercel | Verdict |
|---|---|---|
| Static bundle + CDN | Native | ✅ |
| Leaderboard / level API | Serverless functions | ✅ |
| Replay verification | <100 ms CPU, well inside limits | ✅ |
| Database | Not included → Neon or Vercel Postgres | ✅ free tier is ample |
| Replay blobs | Postgres `bytea` at this size, or Vercel Blob | ✅ |

**Use Hetzner instead only if one of these becomes true:**

1. **Realtime multiplayer** — ghost races or live spectating need persistent WebSockets. Serverless
   cannot hold connections; this is the one hard boundary.
2. **You want to self-host Postgres.** Workable, but Vercel functions connecting to an external
   Postgres over the public internet need connection pooling (PgBouncer) or you will exhaust
   connections under concurrency. Neon's HTTP driver exists precisely to avoid this. Self-hosting
   trades a solved problem for an ops task.
3. **Tournament-scale batch verification** — re-verifying every score after a physics change is a
   batch job better suited to a box you already pay for than to per-invocation billing.

None apply today. My recommendation is Vercel + Neon now, and move the API to Hetzner only when
realtime becomes a real requirement rather than a maybe.

> **OPEN — 8.1:** "23x at Hetzner" — I could not identify this from context. Model, specs, and what
> already runs on it would let me judge whether it changes the recommendation (e.g. if Postgres and
> Caddy are already running there, option 2 gets cheaper).

---

## 9. Risks and open items

**Audio licensing — blocking for public hosting.** `ToDos/0 Not started.md` still lists "Figure out
sound license". The Godot project ships 1.2 MB of `.wav` files (`boost`, `brake_buzz`, `alarm`,
`teleport`, `bling`, `click`, `level_start`) with no license file in the repo. A desktop build shared
with friends is a very different exposure from a public URL on your own domain. Two ways out:

1. Establish provenance for each file and include attribution.
2. **Generate the audio procedurally** — the Swift rewrite already does this, synthesizing ambient,
   boost, brake, and alarm tones as sine sources. It ports directly to WebAudio oscillators, removes
   the 1.2 MB download, and eliminates the licensing question. This is the better answer regardless.

> **DECIDED — 9.1 (2026-08-05): procedural audio.** Port `AudioManager.swift`'s synthesis to
> WebAudio; ship no `.wav` files. The licensing question does not arise. The svgrepo icons still
> need their license checked, or replacing with inline SVG paths.

The SVG icons are from svgrepo and need their license checked the same way.

**UGC moderation.** Public custom-level sharing puts user-submitted names and author strings on your
personal domain. Start with unlisted share links (`/l/<slug>`), add a public browse list only
if it gets used. Cheap insurance: length caps, HTML escaping, a profanity filter on names.

**Mobile controls.** The touch model (boost zone / brake zone) exists in the Swift version and is
sketched in the Godot one. Worth prototyping early — a physics puzzler that is unplayable on phones
loses most of the traffic a personal site sends it.

**Level solvability under any physics change.** All 33 levels are hand-verified against the Godot
model. Any deviation — including the `pow` fix in §6, which changes results in the last bits — needs
an automated solvability check. Worth building a headless harness that replays a known-good input
tape per level in CI.

---

## 10. Suggested sequence

| Phase | Deliverable | Gate |
|---|---|---|
| 0 | Decide §3 fork, §2.2 physics source, audio licensing route | — |
| 1 | `packages/core`: physics + constants + level loading, ported and unit-tested against Godot traces | Trajectories match to tolerance |
| 2 | Canvas renderer + game loop + input; 33 levels playable, no UI chrome | Level 1 completable |
| 3 | HTML UI: menu, level select, HUD, settings, workshop; localStorage persistence | Feature parity minus editor |
| 4 | Deploy static to Vercel on `swingby.magnussaurbier.de` | Publicly playable |
| 5 | API + Neon: leaderboards with replay verification | Scores persist and validate |
| 6 | Editor port + custom level sharing | Levels shareable by link |

Phases 1–2 are the risk. Everything after is conventional web work.

---

## Decisions needed

1. **§3.1** — Godot WASM export (days, heavy, stopgap) or TypeScript rewrite (weeks, the real thing)?
2. **§2.2** — Confirm the Godot physics model is canonical.
3. **§9** — Audio: chase licenses, or go procedural?
4. **§8.1** — What is the Hetzner box?
5. **§2.1** — Does the Swift project continue as the native track?
