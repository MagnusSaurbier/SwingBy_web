# T-14 · LAUNCHPAD — Deploy, routing, CI

**Area:** `infra/`, repo config · **Depends on:** nothing · **Blocks:** nothing (but gates going live)

## Goal

Get the game onto `swingby.magnussaurbier.de`, and set up the CI that keeps the other thirteen tasks
honest.

## Owned files

```
infra/**                    (except schema.sql — T-12 LEDGER owns that)
vercel.json
.github/workflows/**
package.json, tsconfig.json, workspace config
```

You own the monorepo tooling. `npm` workspaces is sufficient — Node 26.5.0 and npm 11.17.0 are
installed, pnpm is not. Do not add a package manager the machine does not have.

## The existing setup — verified, do not re-derive

- `magnussaurbier.de` is a **static `index.html`** (plus `/blog`) in
  `github.com/MagnusSaurbier/magnussaurbier`.
- Hosted on **Vercel**, project `magnus-saurbier/magnussaurbier`, via the GitHub integration.
  **Every push to `main` deploys straight to production** — no build step, no approval gate.
- That repo also runs a scheduled workflow that auto-commits to `main`. Anything you add to its
  `vercel.json` will be live within minutes of a merge, possibly triggered by a bot.

## Deployment shape — own subdomain

SwingBy gets its **own repo, its own Vercel project, and its own subdomain**:
`swingby.magnussaurbier.de`.

**The personal site repo is not modified at all.** No `vercel.json`, no rewrite, no build step added
to a page that currently has none. That is the win over a path-based mount: the CV page and the game
share a brand, not a deployment. Routes are rooted, so there is no base path to thread through the
client either — coordinate that with T-08 BRIDGE, who should have no `BASE_PATH` constant.

### Verified DNS facts — do not re-derive

| Fact | Value |
|---|---|
| Nameservers | `wally.ns.cloudflare.com`, `neil.ns.cloudflare.com` — **DNS is on Cloudflare** |
| Apex `magnussaurbier.de` | `64.29.17.65`, `216.198.79.65` — Vercel anycast |
| `swingby.magnussaurbier.de` | does not resolve yet |

### Setup

1. Add `swingby.magnussaurbier.de` as a domain on the SwingBy Vercel project.
2. In Cloudflare DNS: `CNAME swingby → cname.vercel-dns.com`.
3. **Set that record to "DNS only" (grey cloud), not proxied (orange cloud).** Proxying Cloudflare in
   front of Vercel double-CDNs the site and breaks Vercel's automatic certificate issuance — which
   surfaces as an opaque TLS error, not as anything naming the cause. This is the step that reliably
   goes wrong.

## Checklist

- SwingBy repo created, Vercel project linked, preview deploys on PRs.
- Domain added and DNS record created per above; certificate issued.
- SPA fallback so `/play/builtin-07` serves the app rather than 404ing.
- Cache headers: hashed assets immutable, `index.html` never cached.
- Neon project provisioned, connection string in Vercel env vars for T-12. Never committed.
- No COOP/COEP headers needed — that was the WASM path, which we are not taking.
- The workspace scripts in [PROJECT.md §6](../PROJECT.md#6-toolchain-contract), exactly as named.
- **Optional, and the only thing touching the personal site:** a link to the game from
  `index.html`. That is a one-line change, and it belongs in a PR, not a direct push — every commit
  to that repo's `main` deploys to production immediately.

## CI

Runs on every PR:

1. `tsc --strict` across all workspaces
2. Unit tests per package
3. **T-01 KEPLER's parity suite** — the Godot traces
4. **T-03 ATLAS's solvability suite** — every level still completable
5. Bundle size check: **fail over 250 KB gzipped** for the initial route

Items 3 and 4 are the ones that matter. They are the only mechanism that catches a physics change
quietly breaking level 27, and a green build without them means nothing.

Bundle budget is a hard gate, not a warning. The entire argument for rewriting rather than exporting
WASM was weight; a dependency that silently adds 300 KB erases the reason this project exists.

## Deliverables

| # | Artifact | Path |
|---|---|---|
| 1 | npm workspace root with the §6 scripts | `package.json`, `tsconfig.json` |
| 2 | Per-workspace configs | `packages/*/package.json`, `api/package.json` |
| 3 | Vercel project config | `vercel.json` |
| 4 | CI: typecheck, tests, parity, solvability, bundle gate | `.github/workflows/ci.yml` |
| 5 | Bundle size gate script | `infra/size-check.mjs` |
| 6 | Deploy runbook incl. the Cloudflare DNS step | `infra/DEPLOY.md` |
| 7 | Screenshot of the live site and its certificate, in the PR | — |

## Definition of done

- [ ] `https://swingby.magnussaurbier.de` serves the game over a valid certificate
- [ ] Deep links work on **cold load** (`/play/builtin-07` typed fresh, not navigated to)
- [ ] Preview deploy per PR, URL posted on the PR
- [ ] **CI fails on a deliberately broken parity test** — prove it on a scratch branch
- [ ] **Bundle gate fails on a deliberately fat import** — prove it the same way
- [ ] All seven scripts from [PROJECT.md §6](../PROJECT.md#6-toolchain-contract) exist and work
- [ ] Lighthouse performance **≥ 90** on the game route
- [ ] The Cloudflare record is grey-cloud (DNS only), confirmed in the dashboard
- [ ] `git -C <personal-site> log --oneline` shows no unreviewed commit from this work
- [ ] Plus the global checklist in [PROJECT.md §7](../PROJECT.md#7-definition-of-done-globally)

## Do not

Push directly to the personal site's `main`. Everything there goes live immediately, and it is the
page a recruiter opens. The only change that repo should ever receive from this project is a
reviewed one-line link.

## How to verify

**1. DNS and certificate:**

```bash
dig +short swingby.magnussaurbier.de           # expect a Vercel CNAME/anycast target
curl -sSI https://swingby.magnussaurbier.de | head -5
openssl s_client -connect swingby.magnussaurbier.de:443 -servername swingby.magnussaurbier.de \
  </dev/null 2>/dev/null | openssl x509 -noout -subject -dates
```

Certificate must cover the subdomain and be current. If issuance is stuck, the Cloudflare record is
almost certainly proxied — grey-cloud it and retry.

**2. Deep links on cold load** (a fresh curl, not a click):

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://swingby.magnussaurbier.de/play/builtin-07
```

Must be 200, not 404.

**3. Cache headers:**

```bash
curl -sSI https://swingby.magnussaurbier.de/ | grep -i cache-control              # no-cache
curl -sSI https://swingby.magnussaurbier.de/assets/<hashed>.js | grep -i cache-control  # immutable
```

**4. Prove the gates bite** — both, on a scratch branch, and paste the failing CI run:

```bash
# break parity: flip a sign in physics.ts, push, confirm CI red
# break budget: import a large library into the entry route, push, confirm size gate red
```

A CI that has never failed is not evidence of anything. This is the single most valuable thing this
task delivers.


> **Host-only step.** The personal-site repo is not checked out in the agent container.
> Skip this check and note it as unverified.

**5. Personal site untouched:**

```bash
git -C /Users/magnussaurbier/Documents/Dev/magnussaurbier log --oneline -5
```

Nothing from this project should appear except a reviewed link commit.

**6. Lighthouse** on the game route, performance ≥ 90. Report the score.
