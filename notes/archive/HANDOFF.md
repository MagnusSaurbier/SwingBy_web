# Handoff — what is done, and what needs you

All fourteen tasks are implemented, plus an integration pass that assembles them into a running
game. This file is the consolidated list of what could not be verified inside an agent container,
and what each item needs from you. Per-task detail lives in the individual `results/T-*.md` files;
the reasoning behind decisions lives in `notes/T-*/log.md`.

## Repo state

| Gate | Result |
|---|---|
| `npm run typecheck` | clean, 0 errors |
| `npm test` | 798 passed, 1 skipped, 0 failed (50 files) |
| `npm run lint` | clean |
| `npm run build -w @swingby/web` | succeeds |
| `npm run size` | **PASS — 39.96 KB gzip, 210.04 KB under the 250 KB budget** |

The single skip is T-01 KEPLER's Godot parity gate. It skips loudly and deliberately rather than
passing vacuously — see item 1 below.

End-to-end verification against the **production build** (`vite preview`, not the dev server),
12/12 checks: deep link cold-loads the right level, no `AudioContext` before a user gesture and
exactly one after, canvas renders a real scene, HUD timer advances, the pause button is not
occluded (checked via `elementFromPoint`, not geometry), the editor mounts with a stable canvas and
a wired Share button, and no uncaught errors or failed requests.

---

## What needs you

Ordered by how much it blocks. Items 1 and 2 are gates that currently cannot run at all; the rest
are verification you can do once, or infrastructure you own.

### 1. Godot parity traces — T-01 KEPLER

**The most important item here.** The physics port has never been checked against the real Godot
engine, because there is no Godot binary in the container. Traces were not invented: fabricating
them would have made the parity suite green against physics nobody had verified, which is worse
than having no suite.

Standing in for it: 35 Godot-independent self-consistency tests (two-body orbit energy drift
0.0000%, per-substep zeroing `|real−correct| = 0` vs `|real−buggy| = 139.57`), and an independent
cross-check where T-03's solvability harness solved **32/33 built-in levels** using this physics
without ever reading its source.

Run the exporter on your Mac; the suite then goes green, or does not, without any code change:

```bash
/Applications/Godot.app/Contents/MacOS/Godot --headless \
  --path /Users/magnussaurbier/Documents/Dev/2026_Swingby/SwingBy2026 \
  --script tools/godot-trace/trace.gd
```

Commit the resulting `packages/core/test/parity/traces/level-*.json`, then `npm test -w
@swingby/core -- parity`. Exact format in `packages/core/test/parity/README.md`.

### 2. Neon database — T-12 LEDGER

No route has run against Neon. The schema *was* applied to a real local Postgres 16 and `EXPLAIN
ANALYZE` run against it (Index Scan with early termination at 200k rows), so the query plans are
real — but the `@neondatabase/serverless` HTTP driver has never been exercised.

Provision Neon, put the connection string in Vercel env (never committed), apply
`infra/schema.sql`, re-run the `EXPLAIN`s in `results/T-12-LEDGER.md`, and measure real cold start.

### 3. Deploy — T-14 LAUNCHPAD

Everything code-shaped is done: `vercel.json` with SPA fallback and cache headers, CI with the
parity and solvability gates wired, `infra/size-check.mjs` proven to fail on a real 300 KiB import.
Not done, because it needs your accounts: Vercel project, domain, certificate, preview deploys, and
Lighthouse on the live route.

Full runbook in `infra/DEPLOY.md`. **The step that reliably goes wrong** is the Cloudflare record
for `swingby` — it must be grey-cloud (DNS only). Proxying Cloudflare in front of Vercel breaks
certificate issuance and surfaces as an opaque TLS error that names nothing.

### 4. A real phone — T-06 HELM

Touch is a first-class requirement, and no physical device is reachable from a container. The dev
page exists for exactly this: run `npm run dev -w @swingby/web --host`, then open
`http://<your-mac's-LAN-ip>:5173/src/game/input-dev.html` on your phone and check the zones are
thumb-reachable. Seven-point checklist in `results/T-06-HELM.md`. (`--host` is needed for the phone
to reach the dev server at all; vite binds to localhost otherwise.)

Headless Chromium with real `Touch`/`TouchEvent` dispatch confirmed the logic; it cannot tell you
whether a zone is comfortable to hit.

### 5. Your ears, and real browsers — T-07 CHORUS

Nobody in the container can hear anything, and only headless Chromium was available — Firefox,
Safari and iOS Safari are all untested. Two deliberate deviations from the Swift reference need a
human judgement:

- the **sawtooth brake** (meant to sound rougher than boost, not merely buzzy)
- the **500→900 Hz rising alarm**

Run `npm run dev -w @swingby/web` and open `http://localhost:5173/src/game/audio-dev.html` — button
per voice, alarm slider, live parameter readout. Six specific listener questions are in
`results/T-07-CHORUS.md` §8, deviations first.

The other dev pages, same server: `/src/game/input-dev.html` (input), `/src/hud/hud-dev.html` (HUD
states), `/src/editor/dev.html` (editor). All four verified reachable.

### 6. Godot round-trip of an authored level — T-11 DRAFT

A level was authored with the real editor, validated, round-tripped through `serialize`/`hydrate`,
and proven solvable by driving the real game loop — everything checkable without Godot. Whether
Godot opens it is the one open question. Fixture at
`packages/web/src/editor/fixtures/authored-level.json`; host steps in `results/T-11-DRAFT.md`.

---

## Known issues worth a decision

**No idempotency key in the score wire contract.** T-13 flagged this rather than hiding it: the
frozen `POST /api/score` contract has no idempotency field and the schema has no matching unique
constraint, so duplicate suppression is client-side only. A retry crossing serverless instances
could double-write a score. The client compensates (single-flight drain, dequeue-on-success), but
the guarantee is not enforced server-side. A small schema addition would close it.

**Rate limiting is per-instance.** T-12's limiter is in-memory, so limits are approximate across
warm instances. Redis/KV would fix it; it was out of scope because `api/package.json` belongs to
T-14.

**No `/editor/:levelId` route.** Every visit to the editor starts a fresh level; existing custom
levels cannot be reopened for editing. Noted in `ui/screens/editorPlaceholder.ts`.

---

## Notes on process

Fourteen agents worked in one checkout with disjoint file ownership per
[INTERFACES.md](../INTERFACES.md#file-ownership). No agent ran git; commits were made centrally
after checking `git diff --name-only` against the ownership table.

The run was interrupted **five times** by usage limits and once by a container restart. Nothing was
lost, because everything was committed and pushed at each boundary. `notes/T-*/log.md` holds each
agent's reasoning — decisions, reference findings with line numbers, and dead ends already ruled
out — so a resumed or fresh agent does not re-derive them.

Seven bugs surfaced only at the integration seam, invisible to every per-task suite because each
module was correct on its own: a runaway editor resize loop, a leaderboard silently covering the
completion panel's buttons, an always-mounted HUD wrapper swallowing clicks, and four others. They
are listed in `results/T-08-BRIDGE.md` under "Integration pass". This is the argument for the
integration pass existing at all — fourteen green suites did not mean a working game.
