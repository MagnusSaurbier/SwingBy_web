# Automation — what runs itself, and what still needs a human

Every item that `results/HANDOFF.md` listed as host-only, with what was done about it.
The short version: the deploy chain and the parity gate are now scripted; two items are
irreducibly human, and one is blocked by this container's network policy rather than by
anything in the code.

## Where automation has to live, and why

This agent container's network policy blocks the deploy APIs outright. Verified, not
assumed — the agent proxy reports:

```
connect_rejected  gateway answered 403 to CONNECT   api.vercel.com:443
connect_rejected  gateway answered 403 to CONNECT   api.cloudflare.com:443
connect_rejected  gateway answered 403 to CONNECT   console.neon.tech:443
```

`cdn.playwright.dev` and the Godot downloads are blocked the same way; `registry.npmjs.org`
is allowed.

So automation lives in **GitHub Actions**, not in an agent session. That is the better
home regardless: deploys should not depend on a chat session being alive, secrets belong
in a secret store rather than an agent's environment, and every run is reproducible and
auditable. An agent authors and maintains the workflows; the runner executes them.

## Status

| Was host-only                | Now                                         | Where                                   |
| ---------------------------- | ------------------------------------------- | --------------------------------------- |
| Lighthouse on the live route | **Automated, running**                      | `npm run lighthouse`, in CI on every PR |
| Godot parity traces          | **Automated, needs one run**                | `.github/workflows/parity-traces.yml`   |
| Cloudflare grey-cloud DNS    | **Scripted, untested against the real API** | `infra/cloudflare-dns.mjs`              |
| Vercel project + deploy      | **Scripted, untested against the real API** | `.github/workflows/deploy.yml`          |
| Neon provisioning            | Not automated                               | see below                               |
| Real-phone touch feel        | **Irreducibly human**                       | —                                       |
| Audio judgement              | **Irreducibly human**                       | —                                       |

### Lighthouse — done, and it found nothing wrong

Was "run Lighthouse against the live site", which meant it ran approximately never and
could gate nothing. Pointed at a local `vite preview` of the production build it needs no
deployment, no domain and no human, so it now runs on every PR.

Measured, all four routes: **performance 99–100, accessibility 100**, against thresholds
of 90 (T-14) and 95 (T-08). Proven to fail: raising the performance threshold to 101
exits 1 and names each breach.

`--base <url>` points it at a real deployment instead, which is how `deploy.yml` uses it.

### Godot parity traces — automated, one run needed

The gate that matters most in this project, and it has never run: `traces/` is empty and
the suite skips loudly rather than passing vacuously.

`.github/workflows/parity-traces.yml` installs Godot 4.3 headless on a runner, assembles a
minimal project from the committed `reference/godot/` snapshot via `infra/godot-project.mjs`,
exports the 33 traces, **checks two consecutive runs are byte-identical** (if the exporter
is not deterministic the traces mean nothing), runs the parity suite, and commits the
traces.

No `SwingBy2026` checkout is required: `trace.gd` needs only the `PhysicsEngine` and
`GameConstants` classes and `levels_builtin.json`, all committed here, and both scripts are
dependency-free `class_name` globals.

**This runs once.** Godot is not in the deploy path and never will be — once the traces are
committed, every future CI run replays those numbers for free. The workflow re-triggers only
if `PhysicsEngine.gd`, `GameConstants.gd`, `levels_builtin.json` or the exporter itself
changes.

One caveat by design: traces pin to the committed `reference/godot/` snapshot (SwingBy2026
at dd2b501), not to that repo's HEAD. If the original moves, refresh `reference/godot/`
deliberately — CI will not do it silently.

### Cloudflare DNS — scripted, and this is the one worth automating

`infra/DEPLOY.md` calls grey-cloud "the step that reliably goes wrong". It goes wrong
because it is one toggle a human forgets, and the punishment is an opaque TLS error that
never mentions proxying.

`infra/cloudflare-dns.mjs` makes it `proxied: false` in a payload, then reads the record
back and asserts it. Idempotent: creates if absent, patches a proxied or mis-targeted
record, no-ops when correct. `--dry-run` shows the diff; `--verify` fails instead of fixing,
which is what `deploy.yml` re-runs after deploying.

**Tested against a mock API, never against Cloudflare** (blocked, see above). 8 tests in
`infra/test/cloudflare-dns.test.ts` cover payload shape, the `proxied: false` guarantee,
drift repair, idempotency, both flags, API errors and a missing token. What a mock cannot
prove is whether Cloudflare accepts the token — that is the first real run.

### Vercel — scripted, untested against the real API

`.github/workflows/deploy.yml` gates on typecheck/test/size, deploys, then smoke-tests a
deep link on a cold fetch (`/play/builtin-07` must be 200 — the check that catches a broken
SPA rewrite, which clicking through the app never would), enforces DNS, and runs Lighthouse
against the deployment.

Needs four secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`,
`CLOUDFLARE_API_TOKEN`. The first Vercel project creation is still a dashboard action —
after that everything is the workflow. **Leave Root Directory unset**: pointing it at
`packages/web` builds the site fine and silently drops every `api/**` function.

### Neon — not automated

Deliberately. It is a one-time provisioning step, the API is blocked here, and getting a
connection string into Vercel's env store is a dashboard action anyway. `infra/DEPLOY.md` §5
has the steps, including the one that matters: use the **pooled/HTTP** connection string,
because `api/**` targets `@neondatabase/serverless`'s HTTP driver.

### The two that stay human

**Real-phone touch feel.** Playwright device emulation with real touch events already
covers the mechanical part, and `input-dev.html` exists for the rest — but whether a zone is
comfortable under a thumb is not a measurement. What _could_ be automated as a gate, and is
not yet: asserting tap targets clear 44×44 CSS px.

**Audio.** Whether the sawtooth brake reads as rougher rather than buzzy, and whether the
rising alarm reads as urgent, are aesthetic judgements. The objective half is automatable and
is not yet done: rendering each voice through an `OfflineAudioContext` and asserting on
envelope shape, frequency content, and absence of discontinuities would catch clicks and
regressions without deciding whether it sounds good.
